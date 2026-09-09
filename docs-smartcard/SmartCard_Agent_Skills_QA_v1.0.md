# SmartCard 桌面应用开发：常见问题与解决方案

**版本：v1.1**
**最后更新：2026-09-09**

## 1. 运行时目录锁定导致 `asset not found: index.html`

### 1.1 问题描述

启动桌面应用后，Web Shell 页面显示：

```
asset not found: index.html
/favicon.ico:1 Failed to load resource: the server responded with a status of 500 (Internal Server Error)
(索引):1 Failed to load resource: the server responded with a status of 500 (Internal Server Error)
```

### 1.2 根本原因

`packages/desktop-shell/scripts/prepare-runtime.js` 的 `replaceRuntime()` 步骤失败：

1. `build:runtime` 构建所有包 → 产物在 `dist/`
2. 编译 Rust sidecar
3. 下载/解压 Node.js
4. **替换运行时目录**：把旧的 `runtime/qwen-code` 重命名为 `runtime/.prepare-XXXX/previous`，然后把新构建的临时目录重命名为 `runtime/qwen-code`

**问题出在第 4 步**：如果旧的桌面应用进程还在运行（即使被 `clean:dev` 杀掉后还有残留），`runtime/qwen-code` 目录被 Windows 文件锁定，`renameSync` 失败：

```
Error: EBUSY: resource busy or locked, rename '...\runtime\qwen-code' -> '...\runtime\.prepare-XXXX\previous'
```

此时：

- 新构建的资产没有被复制到运行时目录
- 旧的运行时目录可能不完整（缺少 `cli-entry.js`、`package.json`、`LICENSE`、`README.md` 等由 `prepare-package.js` 生成的文件）
- 桌面应用启动后找不到 `index.html` 和 `cli-entry.js`

### 1.3 为什么经常出现

- **Windows 文件锁定更严格**：进程退出后文件句柄可能不会立即释放
- **`clean:dev` 杀掉进程后**，Windows 可能需要几秒钟才完全释放文件句柄
- **`build:runtime` 在文件释放前开始**，就会遇到 `EBUSY`
- **`prepare-runtime.js` 在 `finally` 块中清理临时目录**，如果 `replaceRuntime` 失败，临时目录被删除，新资产丢失

### 1.4 解决方法

**临时方案**：手动复制缺失的文件到运行时目录

```bash
# 从根目录执行
copy scripts\cli-entry.js dist\cli-entry.js
copy scripts\cli-entry.js packages\desktop-shell\runtime\qwen-code\lib\cli-entry.js
copy package.json dist\package.json
copy package.json packages\desktop-shell\runtime\qwen-code\lib\package.json
copy LICENSE dist\LICENSE
copy LICENSE packages\desktop-shell\runtime\qwen-code\lib\LICENSE
copy README.md dist\README.md
copy README.md packages\desktop-shell\runtime\qwen-code\lib\README.md
```

然后重启桌面应用：

```bash
cd packages\desktop-shell
npm run clean:dev
npm run dev
```

**如果仍然崩溃**：检查 `manifest.json` 是否存在，如果缺失则手动创建：

```bash
# 创建 packages/desktop-shell/runtime/qwen-code/manifest.json
{
  "name": "@qwen-code/qwen-code",
  "desktopVersion": "0.0.1",
  "qwenCodeVersion": "0.22.3",
  "qwenCodeCommit": "dev",
  "target": "windows-x64",
  "node": "v22.23.2",
  "builtAt": "2026-09-09T10:00:00.000Z"
}
```

> ⚠️ **警示（2026-09-09 实测教训）**：上面的手动复制 + 手建 manifest 只是应急续命方案，
> **永远补不出 `checksums.json`**（只有完整跑通 `build:runtime` 才会生成）。用这种半成品
> runtime 时，后续任何 `build:runtime` 失败都会"静默"保留旧产物，造成"改了代码看不到效果"
> 的假象。正确做法是按第 6 节的标准流程让 `build:runtime` 一次原子替换成功，
> 以 `checksums.json` 存在作为唯一成功标志。

**预防方案**：

1. **先清理进程，再构建运行时**：

```bash
cd packages\desktop-shell
npm run clean:dev
timeout /t 5 /nobreak >nul  # 等待文件句柄释放
npm run build:runtime
```

2. **检查运行时目录完整性**：

```bash
dir "packages\desktop-shell\runtime\qwen-code\lib\web-shell\index.html"
dir "packages\desktop-shell\runtime\qwen-code\node\node.exe"
dir "packages\desktop-shell\runtime\qwen-code\lib\cli-entry.js"
```

三个文件都存在说明运行时目录完整。

### 1.5 诊断步骤

1. 检查桌面应用进程是否正在运行：

   ```bash
   tasklist /FI "IMAGENAME eq qwen-code-desktop.exe"
   ```

2. 检查运行时目录完整性：

   ```bash
   dir "packages\desktop-shell\runtime\qwen-code\lib\web-shell\index.html"
   dir "packages\desktop-shell\runtime\qwen-code\node\node.exe"
   dir "packages\desktop-shell\runtime\qwen-code\lib\cli-entry.js"
   dir "packages\desktop-shell\runtime\qwen-code\manifest.json"
   ```

3. 如果 `cli-entry.js` 缺失，执行临时方案中的复制命令。

4. 如果 `manifest.json` 缺失，手动创建（见 1.4 节）。

5. 重启桌面应用并检查输出：
   ```bash
   cd packages\desktop-shell
   npm run clean:dev
   npm run dev
   ```

---

## 2. Agent 执行的 APDU 不在 Console 显示

### 2.1 问题描述

在 Console 面板手动发送 `/apdu` 命令可以正常显示请求和响应，但让 Agent 调用 smartcard tool（如 `smartcard_send_apdu`）时，APDU 执行成功（返回 6A82 等），但 Console 面板看不到任何输出。

### 2.2 根本原因

旧架构中，Agent 工具在 ACP child 进程中执行，每个进程各自 spawn 一个 sidecar：

```
Console (web-shell) ──HTTP──► daemon runtime ──► sidecar A ──► PC/SC
Agent tool (ACP child) ──► child runtime ──► sidecar B ──► PC/SC
```

- Console 和 Agent 使用**不同的 sidecar 连接**，PC/SC 共享模式能共存，但逻辑状态不共享。
- Agent 执行的 APDU 走 child 的 sidecar B，daemon/console 完全看不到。

### 2.3 解决方案

已实施「统一 Daemon 连接 + Console 操作日志」方案：

1. **移除 ACP child sidecar**：`childEnvOverrides` 中移除 `QWEN_SMARTCARD_SIDECAR`
2. **Tool 改为 HTTP 客户端**：5 个 smartcard tool 改为调用 daemon HTTP API（`QWEN_SMARTCARD_DAEMON_URL/TOKEN`）
3. **操作日志 ring buffer**：`smartcard-runtime.ts` 和 `action-executor.ts` 在每次 APDU/connect/disconnect/reset 处 emit 事件
4. **SSE 推送**：daemon 新增 `GET /smartcard/events`（SSE），Console 订阅后实时显示所有操作

### 2.4 验证方法

1. 在 Console 面板手动发送 `/apdu 00A40400A000000003000000`
2. 让 Agent 调用 `smartcard_send_apdu` tool
3. 两者都应在 Console 中显示 APDU 请求和响应

---

## 3. SmartCard 技能不在 `/workspace/skills` 接口返回

### 3.1 问题描述

调用 `http://127.0.0.1:12517/workspace/skills` 接口时，返回的技能列表中没有 `scp02`。

### 3.2 根本原因

`/workspace/skills` 返回的是 workspace 的 skills（通过 `SkillManager.listSkills()`），而 smartcard 的 skills（包括 scp02）注册在 `SmartCardRuntime` 的独立 `SkillRegistry` 上，两者不是同一个 registry。

### 3.3 解决方案

保持现状（有意分离）：

- **`/workspace/skills`**：返回 workspace 的 skills（user/project/extension/bundled）
- **`/smartcard/skills`**：返回 smartcard 的 skills（scp02 等）

前端在技能管理器中增加 **SmartCard** 选项卡（位于"内置"右侧），通过 `/smartcard/skills` 获取并显示 smartcard 技能。

---

## 4. SmartCard 技能卡片点击后跳转到会话页面

### 4.1 问题描述

在 SmartCard 选项卡中点击技能卡片（如 scp02），页面跳转到会话页面，而不是显示技能详情面板。

### 4.2 根本原因

初始实现中，SmartCard 技能卡片的点击事件绑定到了 `onUseSkill`（触发技能使用），而 workspace 技能卡片点击时调用 `setSelectedName`（显示详情面板）。

### 4.3 解决方案

1. 新增 `selectedSmartCardSkill` 状态
2. 点击技能卡片时调用 `setSelectedSmartCardSkill(skill)` 显示详情面板
3. 详情面板包含：技能名称、类别、描述、Skill ID、运行按钮
4. 运行按钮点击时调用 `onUseSkill(skill.skillId)`

---

## 5. 快速参考

### 5.1 常用命令

```bash
# 清理旧进程
cd packages\desktop-shell && npm run clean:dev

# 重建运行时（需要先清理）
cd packages\desktop-shell && npm run build:runtime

# 启动桌面应用
cd packages\desktop-shell && npm run dev

# 检查运行时目录
dir "packages\desktop-shell\runtime\qwen-code\lib\web-shell\index.html"
dir "packages\desktop-shell\runtime\qwen-code\node\node.exe"
dir "packages\desktop-shell\runtime\qwen-code\lib\cli-entry.js"

# 检查桌面应用进程
tasklist /FI "IMAGENAME eq qwen-code-desktop.exe"
```

### 5.2 关键文件

| 文件                                                                | 作用                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/desktop-shell/scripts/prepare-runtime.js`                 | 构建桌面运行时（复制资产、安装 Node.js、编译 sidecar） |
| `packages/desktop-shell/scripts/clean-dev.js`                       | 清理孤立进程                                           |
| `packages/core/src/smartcard/daemon-client.ts`                      | ACP child 侧 HTTP 客户端                               |
| `packages/core/src/smartcard/runtime/operation-log.ts`              | 操作日志 ring buffer                                   |
| `packages/cli/src/serve/routes/workspace-smartcard.ts`              | SmartCard daemon 路由（含 SSE）                        |
| `packages/web-shell/client/components/skills/SkillsManagerPage.tsx` | 技能管理器（含 SmartCard 选项卡）                      |

### 5.3 环境变量

| 变量                          | 作用                                    |
| ----------------------------- | --------------------------------------- |
| `QWEN_SMARTCARD_SIDECAR`      | sidecar 二进制路径（已移除，不再使用）  |
| `QWEN_SMARTCARD_DAEMON_URL`   | daemon 地址（ACP child 用）             |
| `QWEN_SMARTCARD_DAEMON_TOKEN` | smartcard 专用 token（ACP child 用）    |
| `QWEN_CODE_DESKTOP`           | 桌面模式标识（daemon 创建真实 runtime） |

---

## 6. 标准开发流程：改动 web-shell 前端后的检查、编译与启动

> 2026-09-09 实战验证通过的完整流程。改动 web-shell（或任何会进 runtime 的代码）后，
> **必须让 `build:runtime` 完整跑通一次**，桌面应用（`tauri dev`）才会加载到新代码——
> 只在 `packages/web-shell` 下 `npm run build` 是不够的，那只是中间层产物。

### 6.1 完整流程脚本（cmd，按顺序执行）

```bat
:: ============================================================
:: Step 0. 关闭所有桌面应用窗口 + 所有 tauri dev / npm run dev 终端
::          （注意：任何 cmd 窗口如果 cd 到了 runtime\ 目录内，也会锁住它）
:: ============================================================

:: ============================================================
:: Step 1. 进程检查（两条都应该无输出）
:: ============================================================
cd /d D:\softdata\workspaces\buff\smartcard-master\packages\desktop-shell

tasklist | findstr /i "qwen-code"
tasklist | findstr /i "sidecar"

:: node 进程里可能藏着孤儿 daemon，重点看相对路径的 serve 进程：
::   "node lib\cli-entry.js serve --port 0"  ← CWD 在 runtime\qwen-code 内，锁死目录，必杀
::   "node dist\index.js serve --port 0"     ← 其他实例的 daemon，不锁本项目 runtime
wmic process where "name='node.exe'" get ProcessId,CommandLine /format:list

:: 有 "lib\cli-entry.js serve" 就记下 PID 杀掉（只杀带这个特征的，别全杀）：
:: taskkill /PID <PID> /F

:: ============================================================
:: Step 2. 清理残留进程 + 等待文件句柄释放
:: ============================================================
npm run clean:dev
timeout /t 5 /nobreak >nul

:: ============================================================
:: Step 3. 锁探测（可选但强烈建议，10 秒确认能否安全构建）
::          两条都成功 = runtime 目录无进程占用
:: ============================================================
ren runtime\qwen-code qwen-code.test
ren runtime\qwen-code.test qwen-code

:: ============================================================
:: Step 4. 构建运行时（自动重建 web-shell，无需先手动 npm run build）
:: ============================================================
npm run build:runtime

:: ============================================================
:: Step 5. ★ 成功验证（不要只看"没报错"，两条都必须通过）
:: ============================================================
:: 5a. checksums.json 存在 —— 唯一可靠的"完整成功"标志
dir runtime\qwen-code\checksums.json

:: 5b. 新代码特征串在 runtime bundle 里能搜到
::     （把 xxx 换成你这次改动里的特征字符串，如 rapdu、scp02.open）
findstr /s /m "xxx" runtime\qwen-code\lib\web-shell\assets\*.js

:: ============================================================
:: Step 6. 启动桌面应用
:: ============================================================
npm run tauri dev
```

### 6.2 常见故障与处理

| 现象                                                                                   | 原因                                                                                                                  | 处理                                                                                                                      |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `build:runtime` 报 EBUSY (rename runtime\qwen-code)                                    | 有 daemon 进程 CWD 在 runtime\qwen-code 内（`node lib\cli-entry.js serve`，相对路径，`clean:dev` 的过滤条件抓不到它） | `wmic` 找到该 PID → `taskkill /PID xxx /F` → 重跑 Step 3 验证 → 重新构建                                                  |
| `build:runtime` 报 EPERM (unlink ...\.prepare-XXXX\previous\bin\smartcard-sidecar.exe) | **替换其实已成功**，只是清理旧备份时，旧 sidecar exe 还被孤儿进程执行着                                               | 不影响新 runtime，可直接 `tauri dev`。收尾：`tasklist \| findstr /i sidecar` → 杀掉 → `rmdir /s /q runtime\.prepare-XXXX` |
| runtime\ 下有 `.prepare-XXXX` 残留目录                                                 | 上次构建中途失败/被中断                                                                                               | 不用手动删，下次 `build:runtime` 开头的 `recoverInterruptedRuntime()` 会自动清理（新 runtime 在位时不会恢复旧备份）       |
| 改了代码但 tauri dev 看不到效果                                                        | runtime 里还是旧产物（`build:runtime` 从未完整成功过）；或看的是旧窗口                                                | 先 `dir runtime\qwen-code\checksums.json` 判断 runtime 是否完整；关掉所有旧窗口只留新的，窗口内 `Ctrl+Shift+R` 硬刷新     |

### 6.3 排查产物链路：特征字符串逐层 grep

判断"新代码到底走到哪一层"的最快方法：从 diff 里挑一个特征字符串（如 `rapdu`），
逐层验证（Git Bash）：

```bash
# 1. vite 输出
grep -rl "rapdu" packages/web-shell/dist | head -3
# 2. 根目录 dist
grep -rl "rapdu" dist/web-shell | head -3
# 3. 桌面 runtime（tauri dev 实际加载的目录）
grep -rl "rapdu" packages/desktop-shell/runtime/qwen-code/lib/web-shell | head -3
```

前两层有、第三层没有 → `build:runtime` 没跑成功，回到 6.1 Step 4。
另外可直接看 daemon 日志确认实际加载的 bundle：

```bash
tail -50 "C:/Users/<用户名>/AppData/Local/com.alibaba.qwen-code/logs/desktop-runtime.log"
# 关键行： "Web Shell UI served from ...\runtime\qwen-code\lib\web-shell"
#          "route=GET /assets/index-XXXX.js status=200"  ← 看拉的是哪个 hash 的 bundle
```

### 6.4 提效建议

日常只改 web-shell UI 的话，不必每次走完整桌面 runtime 重打包（要下载 Node、编译
Rust sidecar，较慢）。可以先用 `packages/web-shell` 下的 `npm run dev`（vite dev
server，热更新）直接验证界面逻辑，确认无误后再按第 6.1 节做一次 `build:runtime`
打包进桌面端验证 Tauri 集成。
