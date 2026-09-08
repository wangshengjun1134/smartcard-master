# SmartCard PC/SC 访问层：Rust Sidecar 方案设计

**版本：v1.0**
**状态：已定方案，待实施**

## 1. 背景与问题

SmartCard 功能需要在 daemon（`qwen serve`，Node.js 进程）中访问 PC/SC 读卡器（Windows WinSCard / Linux pcsc-lite / macOS CryptoTokenKit）。Node 无法直接调用系统 native API，需要一层桥接。

在前期实现中，曾采用 `@pokusew/pcsclite`（nan 绑定）作为 Node 进程内桥接。该方案暴露了根本问题：

- `@pokusew/pcsclite` 是 2022 年停止维护的 `nan` 绑定，**无预编译二进制**，每次安装都要本地编译。
- 编译需要完整工具链：Windows 需 VS「Desktop development with C++」workload，Linux 需 `gcc`/`g++`/`make`/`python3` + `libpcsclite-dev`（开发库，比运行时库重得多）。
- 这意味着**每台部署机器（含目标 KyLin Linux）都要配一套编译环境**，对"交付给用户使用"的桌面应用负担明显。

## 2. 方案选型

| 方案                               | 最终部署机器需要                               | 结论                                        |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------- |
| A1 nan 绑定（`@pokusew/pcsclite`） | 编译工具链 + dev 库，每次安装都编译            | ❌ 部署负担重                               |
| A2 N-API 预编译                    | 仅运行时库，二进制自动下载                     | 需自研 C++ 封装，前期成本高                 |
| **B1 Rust sidecar**                | 仅运行时库（pcscd/libpcsclite1，桌面标准组件） | ✅ 采用：复用 Rust 生态，编译一次分发二进制 |
| B2 独立 PC/SC 服务                 | 仅运行时库                                     | 多一个常驻服务要运维，偏重                  |
| B3 CLI 工具封装                    | 工具预装                                       | 难做长连接/多 APDU 会话，不适合 SCP02       |

选型依据：项目 desktop-shell 已是 Rust，Rust 的 `pcsc` crate 成熟稳定；sidecar 编译成单二进制随 desktop-shell 分发，用户端只依赖系统标准 PC/SC 运行时。

## 3. 整体架构

```
桌面 webview（Web Shell，操作界面）
   │  HTTP（Bearer token）
   ▼
daemon 进程（qwen serve，Node）           ← 唯一持有读卡器连接
   │  /smartcard/* 路由 + SmartCardRuntime
   │
   │  stdio JSON-RPC（spawn 子进程）
   ▼
smartcard-sidecar 进程（Rust）            ← PC/SC 访问
   │  pcsc crate
   ▼
PC/SC 系统服务（WinSCard / pcscd）
```

设计要点：

1. **daemon 唯一持有读卡器连接**：ACP child（Agent）与前端 console 都通过 daemon 的 `/smartcard/*` HTTP 路由访问，状态统一。
2. **sidecar 由 daemon spawn**：随 daemon 启动而启动、随 daemon 退出而退出，生命周期简单。
3. **sidecar 保持长连接**：PC/SC context 与读卡器连接在 sidecar 进程内保持，多次 APDU 复用同一连接。

## 4. Rust sidecar 设计

### 4.1 位置与组织

```
packages/desktop-shell/src-tauri/
├── Cargo.toml                      # 现有 Tauri 应用
├── src/
│   └── main.rs                     # 现有 Tauri 应用入口
└── smartcard-sidecar/              # 新增：独立 Rust crate
    ├── Cargo.toml
    └── src/
        ├── main.rs                 # stdio JSON-RPC 主循环
        ├── protocol.rs             # 请求/响应类型
        └── service.rs              # pcsc 封装（连接管理）
```

sidecar 作为独立 crate（不纳入 Tauri 的 `[dependencies]`，避免链接重量级 Tauri 依赖），通过 `cargo build` 独立编译。

### 4.2 依赖

```toml
[dependencies]
pcsc = "2"          # PC/SC 绑定
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

## 5. 通信协议（stdio JSON-RPC）

一行一 JSON，`\n` 分隔。daemon 为客户端，sidecar 为服务端。

### 5.1 请求

```json
{ "id": 1, "method": "list_readers", "params": {} }
```

### 5.2 响应

```json
{ "id": 1, "result": { "readers": [...] } }
```

或错误：

```json
{ "id": 1, "error": "reader not found" }
```

### 5.3 方法定义

| 方法           | 参数                                                    | 返回                          |
| -------------- | ------------------------------------------------------- | ----------------------------- |
| `list_readers` | —                                                       | `{ readers: [{ id, name }] }` |
| `connect`      | `{ reader_id }`                                         | `{ atr }`                     |
| `disconnect`   | `{ reader_id }`                                         | `{}`                          |
| `reset`        | `{ reader_id }`                                         | `{ atr }`                     |
| `transmit`     | `{ reader_id, apdu: { cla, ins, p1, p2, data?, le? } }` | `{ data, sw1, sw2, sw }`      |
| `close`        | —                                                       | `{}`                          |

APDU 的 `data` 为 hex 字符串（空字符串表示无数据）。

## 6. daemon 侧：SidecarCardTransport

新增 `SidecarCardTransport`，实现 core 已有的 `CardTransport` 接口，内部：

1. spawn sidecar 二进制（`child_process.spawn`）；
2. 维护请求 id 与 pending Promise 的映射；
3. 逐行解析 sidecar 的 stdout，按 id 回填 Promise；
4. sidecar 退出/崩溃时，reject 所有 pending 请求并标记 transport 不可用。

文件位置：`packages/core/src/smartcard/transport/sidecar-transport.ts`。

## 7. 现有代码改造点

| 位置                                                          | 改造                                                                                                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/desktop-shell/src-tauri/smartcard-sidecar/`         | **新增** sidecar crate                                                                                                                 |
| `packages/core/src/smartcard/transport/sidecar-transport.ts`  | **新增** SidecarCardTransport                                                                                                          |
| `packages/core/src/smartcard/factory.ts`                      | 默认 transport 由 `PcscliteCardTransport` 改为 `SidecarCardTransport`（按环境变量 `QWEN_SMARTCARD_SIDECAR` 定位二进制，缺省回退 mock） |
| `packages/core/src/smartcard/transport/pcsclite-transport.ts` | **移除**（不再采用）                                                                                                                   |
| `packages/core/src/smartcard/transport/pcsclite.d.ts`         | **移除**                                                                                                                               |
| `packages/core/package.json`                                  | 移除 `@pokusew/pcsclite` optionalDependency                                                                                            |
| `packages/desktop-shell/src-tauri/src/runtime.rs`             | spawn daemon 时注入 `QWEN_SMARTCARD_SIDECAR` 环境变量，指向 sidecar 二进制路径                                                         |
| `packages/desktop-shell/scripts/prepare-runtime.js`           | 编译 sidecar 并将产物复制到 runtime 目录                                                                                               |

## 8. 编译与分发

1. sidecar 编译：`cargo build --release --manifest-path packages/desktop-shell/src-tauri/smartcard-sidecar/Cargo.toml`；
2. 产物 `smartcard-sidecar(.exe)` 复制到 runtime 目录 `packages/desktop-shell/runtime/qwen-code/bin/`；
3. desktop-shell 打包时 runtime 目录随 `resources` 一起分发；
4. daemon 启动时由 desktop-shell 注入 `QWEN_SMARTCARD_SIDECAR` 环境变量指向该二进制。

## 9. 实施步骤

1. 编写 sidecar Rust crate（protocol + service + 主循环），用 `pcsc` crate 实现 6 个方法；
2. 本地用 `cargo test` 验证 sidecar 的 JSON-RPC 协议（读卡器连接、APDU 收发）；
3. 编写 `SidecarCardTransport`（Node 侧子进程 + JSON-RPC 客户端），实现 `CardTransport`；
4. 改造 factory，默认用 sidecar，mock 作为 `QWEN_SMARTCARD_MOCK=1` 回退；
5. 移除 pcsclite 相关代码与依赖；
6. 集成编译分发：prepare-runtime.js 编译 sidecar + runtime.rs 注入环境变量；
7. 端到端验证：前端 console 连接/断开/发 APDU、SCP02 skill 执行。
