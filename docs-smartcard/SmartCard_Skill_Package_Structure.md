# SmartCard Skill 标准包结构

## 目录结构

一个标准的 SmartCard Skill 包必须包含以下文件：

```
hello.world/
├── SKILL.md          # 必需：技能文档（Qwen Code 标准格式）
├── skill.json        # 必需：元数据（SmartCard Runtime 使用）
└── index.ts          # 必需：入口文件（Node.js/TypeScript）
```

## 文件说明

### 1. SKILL.md（必需）

Qwen Code 标准技能文档，包含 YAML frontmatter 和 Markdown 内容。

```markdown
---
name: hello-world
description: Multi-step SmartCard skill example with state machine and context management.
license: Apache-2.0
---

# Hello World SmartCard Skill

[技能描述、使用方法、架构说明等]
```

**Frontmatter 字段：**

- `name` - 技能名称（kebab-case）
- `description` - 简短描述
- `license` - 许可证

### 2. skill.json（必需）

SmartCard Runtime 元数据，定义技能的运行时配置。

```json
{
  "skillId": "hello.world",
  "version": "1.0.0",
  "name": "Hello World",
  "description": "Multi-step SmartCard skill example.",
  "category": "custom",
  "runtime": {
    "type": "node",
    "version": "22+"
  },
  "entry": "index.ts"
}
```

**字段说明：**

- `skillId` - 唯一标识符（dot-separated）
- `version` - 语义化版本号
- `name` / `description` - 人类可读的名称和描述
- `category` - 分类（`filesystem` | `security` | `crypto` | `authentication` | `custom`）
- `runtime.type` - 运行时类型（`node` | `python`）
- `runtime.version` - 运行时版本要求
- `entry` - 入口文件（相对于技能包目录）

### 3. 入口文件（必需）

技能的执行入口，根据 `runtime.type` 决定文件扩展名：

- **Node.js**: `index.ts` 或 `index.js`
- **Python**: `main.py`

入口文件必须实现 IPC 协议：

- 从 stdin 读取 JSON Lines（Runtime → Skill 消息）
- 向 stdout 写入 JSON Lines（Skill → Runtime 消息）
- 向 stderr 写入日志

## IPC 协议

### Skill → Runtime

**1. 请求执行 Action**

```json
{
  "type": "skill_action",
  "executionId": "exec-123",
  "action": {
    "id": "select-aid",
    "type": "APDU",
    "name": "SELECT Applet",
    "apdu": {
      "cla": 0x00,
      "ins": 0xa4,
      "p1": 0x04,
      "p2": 0x00,
      "data": [0xa0, 0x00, 0x00, 0x00, 0x01, 0x01]
    }
  }
}
```

**2. 输出事件**

```json
{
  "type": "output",
  "executionId": "exec-123",
  "level": "INFO",
  "message": "[WAIT_SELECT] SELECT OK",
  "data": { "response_length": 21 }
}
```

**3. 执行完成**

```json
{
  "type": "execution_finished",
  "executionId": "exec-123",
  "status": "SUCCESS",
  "data": {
    "iccid": "988600123456789021431",
    "atr": "3B8F..."
  }
}
```

### Runtime → Skill

**1. 开始执行**

```json
{
  "type": "start",
  "executionId": "exec-123",
  "skillId": "hello.world",
  "input": { "name": "Test User" },
  "cardSession": {
    "readerId": "reader-01",
    "atr": "3B8F...",
    "connected": true
  }
}
```

**2. Action 结果**

```json
{
  "type": "action_result",
  "executionId": "exec-123",
  "actionId": "select-aid",
  "actionType": "APDU",
  "success": true,
  "response": {
    "sw": 36864,
    "data": [98, 26, 130, 2, 56, 1]
  }
}
```

**3. 停止执行**

```json
{
  "type": "stop",
  "executionId": "exec-123",
  "reason": "Timeout"
}
```

## 上传方式

### 方法 1：桌面客户端上传

1. 将技能包目录打包（ZIP 或保持目录结构）
2. 打开桌面客户端：插件 → 技能 → 上传
3. 选择技能包目录或 ZIP 文件
4. 上传成功后，技能会自动注册到 Runtime

### 方法 2：编程方式加载

```typescript
import { createSmartCardRuntime } from '@qwen-code/qwen-code-core/smartcard';

const runtime = createSmartCardRuntime();

// 从目录加载（会扫描子目录中的 skill.json）
const definitions = runtime.loadSkillsFromDirectory('/path/to/skills');

console.log(`Loaded ${definitions.length} skills:`);
definitions.forEach((def) => {
  console.log(`  - ${def.skillId} (${def.runtime.type})`);
});

// 执行技能
const result = await runtime.executeSkillViaRuntime(
  'hello.world',
  '/path/to/hello.world',
  { name: 'Test User' },
);

console.log('Result:', result.status);
```

## 示例

### Node.js/TypeScript 技能

```
hello.world/
├── SKILL.md
├── skill.json
└── index.ts
```

### Python 技能

```
read.iccid/
├── SKILL.md
├── skill.json
└── main.py
```

## 注意事项

1. **SKILL.md 是必需的** - Qwen Code 桌面客户端要求每个技能包必须包含 SKILL.md
2. **入口文件必须实现 IPC 协议** - 通过 stdin/stdout 与 Runtime 通信
3. **技能包应该是自包含的** - 避免外部依赖，或确保依赖文件一起打包
4. **TypeScript 技能需要 tsx 运行时** - Runtime 会自动检测并使用 tsx 执行 .ts 文件
5. **Python 技能需要 Python 3.10+** - Runtime 使用 `python` 命令执行

## 设计文档

- 设计文档：`docs-smartcard/SmartCard_Agent_Skills_Desgin_v2.4.md`
- 使用指南：`docs-smartcard/SmartCard_Multi_Language_Skills_Guide.md`
- 实现总结：`docs-smartcard/SmartCard_Multi_Language_Implementation_Summary.md`
