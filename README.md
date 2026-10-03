<div align="center">

[![License](https://img.shields.io/github/license/wangshengjun1134/smartcard-master.svg)](./LICENSE)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)

**SmartCard Agent — 基于 Qwen Code 构建的智能卡 Agent 应用**

</div>

## 项目简介

SmartCard Master 是从 [Qwen Code](https://github.com/QwenLM/qwen-code) fork 的专用 Agent 应用，专注于智能卡（SmartCard）领域的自动化操作和开发。

本项目保留了 Qwen Code 的核心 Agent 能力（Auto-Memory、Auto-Skills、SubAgents、MCP 等），并深度集成了 SmartCard 专用工具链，包括：

- **APDU 命令交互** — 通过 Web Shell 控制台直接与智能卡通信，支持 hex APDU 命令发送和实时响应显示
- **SmartCard Agent Tools** — 内置 connect、disconnect、send-apdu、reset、execute-skill 等 Agent 工具
- **Skill 运行时** — 支持 Node.js 和 Python 两种 Skill Host，可在隔离进程中执行智能卡操作（如 SCP02 安全通道、ICCID 读取等）
- **Daemon 独占 PC/SC** — Daemon（`qwen serve`）作为唯一的 PC/SC 连接持有者，避免多进程竞争
- **SSE 实时日志** — 所有 SmartCard 操作日志通过 SSE 事件流实时推送到前端控制台

## 架构概览

```
┌─────────────┐     HTTP+SSE      ┌──────────────────┐     Direct      ┌──────────────┐
│  Web Shell  │ ────────────────→ │  Daemon (serve)  │ ──────────────→ │ Core SmartCard│
│  (React UI) │ ←──────────────── │  qwen serve      │                 │ (Runtime)     │
└─────────────┘     SSE Events    └──────────────────┘                 └───────┬───────┘
                                                                              │
                                                                         CardTransport
                                                                              │
                                                                              ▼
                                                                    ┌──────────────────┐
                                                                    │  PC/SC Sidecar   │
                                                                    │  (Rust 子进程)    │
                                                                    └────────┬─────────┘
                                                                             │
                                                                             ▼
                                                                    ┌──────────────────┐
                                                                    │  智能卡硬件        │
                                                                    │  (PC/SC Reader)   │
                                                                    └──────────────────┘
```

## 安装与构建

本项目与 Qwen Code 使用相同的构建流程。

### 前置要求

- **Node.js >= 22**（Ink 7 + React 19.2 要求）
- npm（随 Node.js 安装）

### 安装依赖

```bash
npm install
```

### 构建

```bash
npm run build      # 构建所有包（TypeScript 编译 + 资源复制）
npm run build:all  # 构建所有内容（包括沙箱容器）
npm run bundle     # 将 dist/ 打包为单个 dist/cli.js（需先 build）
```

### 开发

```bash
npm run dev        # 直接从 TypeScript 源码运行 CLI（无需 build）
```

使用 `DEV=true` 运行，对 `packages/core` 或 `packages/cli` 的更改会立即生效，无需重新构建。

### Web Shell 开发

```bash
cd packages/web-shell && npm run dev
```

使用 vite 开发服务器进行热重载开发，无需完整构建周期。

### Desktop Shell 构建

```bash
cd packages/desktop-shell
npm run build:runtime    # 构建并打包 web-shell 到 runtime 目录
npm run tauri dev        # 启动桌面应用开发模式
```

## 快速开始

```bash
qwen          # 启动交互式终端 UI
# 在会话中：
/auth         # 配置 Provider 和 API Key
```

## SmartCard 功能

### 控制台面板

Web Shell 内置 SmartCard 控制台，提供：

- **APDU 命令输入** — 支持 hex 格式 APDU 命令，自动换行（`word-break: break-all`）
- **快捷指令** — `/apdu`、`/reset`、`/help` 等命令
- **自动滚动** — 新日志自动滚动到底部
- **SSE 实时日志** — 所有操作日志实时推送显示

### Agent 工具

SmartCard 子系统提供以下 Agent 工具：

| 工具            | 功能                                         |
| --------------- | -------------------------------------------- |
| `connect`       | 连接读卡器，建立会话                         |
| `disconnect`    | 断开连接，释放 PC/SC 句柄                    |
| `send-apdu`     | 发送 APDU 命令到智能卡                       |
| `reset`         | 复位智能卡                                   |
| `execute-skill` | 执行 SmartCard Skill（如 SCP02、ICCID 读取） |

### Skill 运行时

SmartCard Skill 支持两种执行环境：

- **Node.js Host** — 通过 `process-node-host.ts` 在独立 Node 进程中执行
- **Python Host** — 通过 `process-python-host.ts` 在独立 Python 进程中执行

内置 Skill：

- **SCP02** — 智能卡安全通道协议
- **Read ICCID** — 读取 SIM 卡 ICCID
- **Hello World** — Skill 开发示例

## 项目结构

```
packages/
├── cli/                  # CLI 入口（qwen 命令）
├── core/                 # 核心引擎（agent + tools + providers）
│   └── src/smartcard/   # SmartCard 子系统
│       ├── runtime/     # Skill 运行时
│       ├── skills/      # 内置 Skill
│       ├── tools/       # Agent 工具
│       └── transport/   # Card Transport（Sidecar/Mock）
├── web-shell/           # Web Shell UI（React + TypeScript）
├── desktop-shell/       # 桌面应用（Tauri）
├── channels/            # IM 渠道（Telegram/微信/钉钉/飞书）
├── acp-bridge/          # Agent Client Protocol 桥接
├── qwen-live/           # 多客户端共享会话
└── sdk-*/               # SDK（TypeScript/Python/Java）
```

## 开发指南

### 单元测试

```bash
cd packages/core && npx vitest run src/path/to/file.test.ts
cd packages/cli && npx vitest run src/path/to/file.test.ts
```

### 集成测试

```bash
npm run build && npm run bundle
cd integration-tests && cross-env QWEN_SANDBOX=false npx vitest run cli interactive
```

### 代码检查

```bash
npm run lint       # ESLint 检查
npm run lint:fix   # 自动修复
npm run format     # Prettier 格式化
npm run typecheck  # TypeScript 类型检查
```

## 技术栈

- **运行时**: Node.js >= 22
- **UI 框架**: React 19.2 + Ink（终端 UI）
- **Web UI**: React + TypeScript + Vite
- **桌面应用**: Tauri
- **测试**: Vitest
- **构建**: TypeScript 编译 + esbuild 打包
- **智能卡**: PC/SC API + Rust Sidecar

## 许可证

与 Qwen Code 保持一致。

## 致谢

本项目基于 [Qwen Code](https://github.com/QwenLM/qwen-code) 构建，感谢 Qwen Code 团队提供的优秀 Agent 框架。
