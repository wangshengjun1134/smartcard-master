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

---

## 10. 统一连接与操作日志：让 Agent 执行的 APDU / Skill 输出在 UI 可见（v1.1 增补）

### 10.1 背景与问题

第 3 节已声明「daemon 唯一持有读卡器连接」，但当前实现并未完全落地——**ACP child 也自建了 sidecar**：

- `config.ts` 在每个进程（daemon 和 ACP child）里，只要 `QWEN_CODE_DESKTOP === '1'` 或 `QWEN_SMARTCARD_SIDECAR` 存在，就各自 `createSmartCardRuntime()`。
- daemon 通过 `childEnvOverrides` 把 `QWEN_SMARTCARD_SIDECAR` 传给 ACP child，child 据此 spawn 自己的 sidecar。
- 因此实际存在**两条互不相知的读卡器连接**：

```
console (web-shell) ──HTTP──► daemon runtime ──► sidecar A ──► PC/SC
agent tool (ACP child) ─────► child runtime ──► sidecar B ──► PC/SC
```

后果：

1. **Agent 执行的 APDU 在 console 不可见**：console 手动 `/apdu` 能显示（走 daemon 的 sidecar A），但 agent 通过 tool/skill 执行的 APDU 走 child 的 sidecar B，console 完全看不到请求/响应。
2. **Skill 输出也传不到 UI**：skill 的 `SkillOutputSink` 事件（text/info/warn/error/data）在 child 的 `SkillExecutor` 里产生，同样困在 child 进程内。
3. 额外发现：daemon 进程内其实有**两个** runtime——`config.ts` 建了一个（`setSmartCardRuntime`），`server.ts` 的 `registerSmartCardRoutes` 又 `createSmartCardRuntime()` 建了一个（console 用的是后者）。

### 10.2 目标架构

让 **daemon 成为唯一的读卡器连接 + 操作日志 owner**，ACP child 的 smartcard tool 全部改为调用 daemon 的 HTTP 接口（与 console 走同一条路）。所有 APDU 与 skill 输出都在 daemon 单点产生，UI 订阅该点即可全量可见。

```
console (web-shell) ───HTTP───┐
                              ├──► daemon 唯一 runtime ──► 唯一 sidecar ──► PC/SC
agent tool (ACP child) ──HTTP──┘            │
                                     操作日志 ring buffer ──SSE──► console
```

要点：

1. **单连接、单状态**：读卡器连接（`readerId`/`atr`）只由 daemon 的 runtime 持有；child 不再维护本地状态，只做转发。
2. **操作日志在 daemon**：每次 APDU 请求/响应、connect/disconnect/reset、skill 事件都写入 daemon 内存中的 ring buffer（带条数上限）。
3. **SSE 推送**：daemon 新增 `GET /smartcard/events`（SSE），连接时先回放最近 N 条，之后实时推送。

### 10.3 两个显示目标

| 内容                                            | 显示位置             | 通道                                                           |
| ----------------------------------------------- | -------------------- | -------------------------------------------------------------- |
| APDU 请求/响应（所有来源：手动、tool、skill）   | **console 面板**     | daemon 操作日志 → `GET /smartcard/events` SSE                  |
| Skill 输出（text/info/warn/error/data，含流式） | **聊天主窗口内容区** | `execute-skill` tool 的流式输出（复用 `canUpdateOutput` 机制） |

### 10.4 ACP child 侧：tool 改为 HTTP 客户端

新增 `packages/core/src/smartcard/daemon-client.ts`（Node 侧 `fetch` 封装，对齐 web-shell 已有的 `smartcard-api.ts`），从环境变量读取 daemon 地址与凭据，提供 `listReaders/connect/disconnect/reset/sendApdu/executeSkill`。

五个 tool 的 `execute()` 全部改为调用 daemon-client：

| tool            | 目标路由                                                      |
| --------------- | ------------------------------------------------------------- |
| `connect`       | `GET /smartcard/readers`（无参时）/ `POST /smartcard/connect` |
| `disconnect`    | `POST /smartcard/disconnect`                                  |
| `reset`         | `POST /smartcard/reset`                                       |
| `send-apdu`     | `POST /smartcard/apdu`                                        |
| `execute-skill` | `POST /smartcard/skills/:id/execute`                          |

关键点：**skill 在 daemon 执行**（`execute-skill` 调 daemon 路由），这样 skill 的 APDU 走 daemon sidecar（进操作日志 → console 可见），skill 的输出事件在 daemon 产生、可流式回传。

### 10.5 操作日志与流式输出

- **操作日志**（新增 `packages/core/src/smartcard/runtime/operation-log.ts`）：内存 ring buffer，记录 APDU 请求 hex + 响应 SW/data、connect/disconnect/reset、skill 事件（start/end/text/info/warn/error/data）。
- **`smartcard-runtime.ts`**：在 `sendApdu/connect/disconnect/reset` 处发操作事件；**`skill-executor.ts`** 的 `SkillOutputSink` 改为实时 emit（不再只是最后一次性返回的 `events` 数组，`events` 仍保留用于返回值）。
- **流式 skill 输出到聊天窗口**：`POST /smartcard/skills/:id/execute` 支持 SSE 流式返回 skill 事件；child 的 `execute-skill` tool 消费该 SSE，通过 `canUpdateOutput` 实时更新推送到聊天窗口（复用现有 tool 输出流式机制，参照 `AgentTool`）。首版可先返回完整结果（非流式），流式作为增量。

### 10.6 通信与认证（安全不放松）

- daemon 在 `run-qwen-serve.ts` 的 `childEnvOverrides` 中**移除** `QWEN_SMARTCARD_SIDECAR`，改为注入：
  - `QWEN_SMARTCARD_DAEMON_URL`：daemon 地址（复用现有 `formatChannelWorkerDaemonUrl` 得到 loopback URL）。
  - `QWEN_SMARTCARD_DAEMON_TOKEN`：smartcard 专用凭据，仅 `/smartcard/*` 路由接受（值可复用 daemon bearer token，通过「专用 env 名 + 仅 smartcard 路由校验」实现作用域收敛；或单独生成一个 scoped token）。
- 全局 `QWEN_SERVER_TOKEN` 校验不动，也不把 `QWEN_SERVER_TOKEN` 塞进 child env（保留 `spawnChannel.ts` 现有的 strip 机制）。

### 10.7 改动清单

| 位置                                                                  | 改动                                                                                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/core/src/smartcard/daemon-client.ts`                        | **新增**：child 侧 HTTP 客户端（读 daemon URL + 凭据，`fetch` 封装）                                      |
| `packages/core/src/smartcard/runtime/operation-log.ts`                | **新增**：操作日志 ring buffer                                                                            |
| `packages/core/src/smartcard/runtime/smartcard-runtime.ts`            | 增加操作事件 emit（apdu/connect/disconnect/reset/skill）                                                  |
| `packages/core/src/smartcard/runtime/skill-executor.ts`               | `SkillOutputSink` 实时 emit（而非仅收集）                                                                 |
| `packages/core/src/smartcard/tools/send-apdu.ts`                      | `execute()` 改为调 daemon-client                                                                          |
| `packages/core/src/smartcard/tools/connect.ts`                        | 同上                                                                                                      |
| `packages/core/src/smartcard/tools/disconnect.ts`                     | 同上                                                                                                      |
| `packages/core/src/smartcard/tools/reset.ts`                          | 同上                                                                                                      |
| `packages/core/src/smartcard/tools/execute-skill.ts`                  | 同上（调用 `/skills/:id/execute`，消费 SSE 流式输出）                                                     |
| `packages/core/src/smartcard/tools/context.ts`                        | 改为提供 daemon-client（或移除 `requireSmartCardRuntime` 的使用）                                         |
| `packages/cli/src/config/config.ts`                                   | 仅 daemon 进程创建真实 runtime（sidecar）；child 不再创建本地 runtime                                     |
| `packages/cli/src/serve/run-qwen-serve.ts`                            | `childEnvOverrides` 移除 `QWEN_SMARTCARD_SIDECAR`，注入 daemon URL + scoped 凭据                          |
| `packages/cli/src/serve/routes/workspace-smartcard.ts`                | 新增 `GET /smartcard/events`（SSE，回放+推送）；smartcard 路由额外接受 scoped 凭据；接入操作日志          |
| `packages/cli/src/serve/server.ts`                                    | 合并 daemon 内的两个 runtime 为同一个（复用 `config` 上的实例，供路由与日志共用）                         |
| `packages/web-shell/client/components/smartcard/SmartCardConsole.tsx` | 用 `EventSource` 订阅 `/smartcard/events`，渲染 APDU 请求/响应（手动 `/apdu` 也统一走日志，避免重复显示） |
| `packages/web-shell/client/components/smartcard/smartcard-api.ts`     | 增加 events 订阅 helper                                                                                   |

### 10.8 实施步骤

1. 新增 `daemon-client.ts`（child 侧 HTTP 客户端）与 `operation-log.ts`（ring buffer）。
2. `smartcard-runtime.ts` / `skill-executor.ts` 增加操作事件 emit。
3. 五个 tool 的 `execute()` 改为调用 daemon-client；调整 `context.ts`。
4. `config.ts` 仅 daemon 创建真实 runtime；`run-qwen-serve.ts` 改 childEnvOverrides。
5. `server.ts` 合并双 runtime；`workspace-smartcard.ts` 新增 `/smartcard/events` SSE + scoped 凭据校验 + 操作日志接入。
6. `SmartCardConsole.tsx` 订阅 SSE 渲染 APDU；`smartcard-api.ts` 增加订阅 helper。
7. 单元测试：操作日志、daemon-client（mock fetch）、tool 的 HTTP 调用路径。
8. 端到端验证：console 手动 `/apdu`、agent tool `/apdu`、SCP02 skill 三者执行后，APDU 请求/响应均在 console 显示；skill 输出在聊天主窗口显示。
