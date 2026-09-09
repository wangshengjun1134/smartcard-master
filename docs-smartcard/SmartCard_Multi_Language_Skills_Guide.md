# SmartCard 多语言 Skill 系统

## 概述

SmartCard Skill 系统支持使用多种语言（Node.js/TypeScript、Python）实现智能卡协议技能。Agent 不关心 Skill 的实现语言，只负责发起执行、接收过程输出和最终结果。

**核心原则：**

> Agent 负责调用 Skill；Skill 负责协议逻辑；Runtime 负责 Skill 如何运行。

## 架构

```
                     Agent
                       |
                       v
                SkillExecutor
                       |
                       v
                 SkillRuntime
              +--------+---------+
              |                  |
              v                  v
         ProcessNodeHost    ProcessPythonHost
              |                  |
              v                  v
          Node.js Process    Python Process
              |                  |
              +--------+---------+
                       |
                       v
               Skill Runtime API
```

## Skill 包结构

每个 Skill 是一个目录，包含 `skill.json` 元数据文件：

```
skills/
  scp02.open/              # Node.js/TypeScript Skill
    skill.json
    index.ts
    crypto.ts
    constants.ts
    state.ts
    session.ts

  read.iccid/              # Python Skill
    skill.json
    main.py
    requirements.txt
```

### skill.json 格式

```json
{
  "skillId": "scp02.open",
  "version": "1.0.0",
  "name": "SCP02 Open Secure Channel",
  "description": "Establish a GlobalPlatform SCP02 secure channel.",
  "category": "security",
  "runtime": {
    "type": "node",
    "version": "22+"
  },
  "entry": "index.ts"
}
```

**字段说明：**

- `skillId`: 唯一标识符
- `version`: 语义化版本号
- `name` / `description`: 人类可读的名称和描述
- `category`: 分类（`filesystem` | `security` | `crypto` | `authentication` | `custom`）
- `runtime.type`: 运行时类型（`node` | `python` | `java`）
- `runtime.version`: 运行时版本要求（可选）
- `entry`: 入口文件（相对于 skill 目录）

## 使用方式

### 1. 从目录加载 Skill 包

```typescript
import { SmartCardRuntime } from '@qwen-code/qwen-code-core/smartcard';

const runtime = createSmartCardRuntime();

// 从目录加载所有 skill 包
const definitions = runtime.loadSkillsFromDirectory('/path/to/skills');

console.log(`Loaded ${definitions.length} skills:`);
definitions.forEach((def) => {
  console.log(`  - ${def.skillId} (${def.runtime.type})`);
});
```

### 2. 执行 Node.js Skill

Node.js Skill 在独立子进程中运行，通过 JSON Lines IPC 通信。

```typescript
const result = await runtime.executeSkillViaRuntime(
  'scp02.open', // skillId
  '/path/to/skills/scp02.open', // 包路径
  {
    keys: {
      enc: '000102030405060708090A0B0C0D0E0F',
      mac: '101112131415161718191A1B1C1D1E1F',
    },
    keyVersion: 0x01,
  },
);

console.log('Status:', result.status);
console.log('Error:', result.error);
```

### 3. 执行 Python Skill

Python Skill 同样在独立子进程中运行。

```typescript
const result = await runtime.executeSkillViaRuntime(
  'read.iccid',
  '/path/to/skills/read.iccid',
  {}, // Python skill 的输入参数
);

if (result.status === 'SUCCESS') {
  console.log('ICCID read successfully');
}
```

## 实现 Skill

### Node.js/TypeScript Skill

1. 创建 `skill.json`：

```json
{
  "skillId": "my.skill",
  "version": "1.0.0",
  "name": "My Skill",
  "description": "Description",
  "category": "custom",
  "runtime": {
    "type": "node",
    "version": "22+"
  },
  "entry": "index.ts"
}
```

2. 创建入口文件 `index.ts`：

```typescript
import type {
  Skill,
  SkillContext,
  SkillInput,
  SkillSession,
  SkillResult,
  ActionResult,
} from '@qwen-code/qwen-code-core/smartcard/skills';

export class MySkill implements Skill {
  skillId = 'my.skill';
  name = 'My Skill';
  description = 'Description';
  category = 'custom' as const;

  createSession(context: SkillContext, input: SkillInput): SkillSession {
    return {
      sessionId: `my-skill-${Date.now()}`,
      skillId: this.skillId,
      status: 'RUNNING',
    };
  }

  async start(
    context: SkillContext,
    session: SkillSession,
  ): Promise<SkillResult> {
    context.output.info('Starting my skill');

    // 请求执行 APDU 命令
    return {
      status: 'CONTINUE',
      nextAction: {
        id: 'my-apdu',
        type: 'APDU',
        name: 'Send APDU',
        apdu: {
          cla: 0x00,
          ins: 0xa4,
          p1: 0x00,
          p2: 0x00,
          data: [0xa0, 0x00, 0x00, 0x00, 0x01, 0x01],
        },
      },
    };
  }

  async handleResult(
    context: SkillContext,
    result: ActionResult,
    session: SkillSession,
  ): Promise<SkillResult> {
    if (!result.success) {
      return { status: 'FAILED', error: result.error };
    }

    context.output.info('APDU successful');
    return { status: 'SUCCESS' };
  }
}

export default MySkill;
```

### Python Skill

1. 创建 `skill.json`：

```json
{
  "skillId": "my.python.skill",
  "version": "1.0.0",
  "name": "My Python Skill",
  "description": "A Python skill",
  "category": "custom",
  "runtime": {
    "type": "python",
    "version": "3.10+"
  },
  "entry": "main.py"
}
```

2. 创建入口文件 `main.py`：

```python
#!/usr/bin/env python3
import json
import sys

def send_message(msg):
    """发送 Skill→Runtime 消息"""
    sys.stdout.write(json.dumps(msg) + '\n')
    sys.stdout.flush()

def read_message():
    """读取 Runtime→Skill 消息"""
    line = sys.stdin.readline()
    if not line:
        return None
    return json.loads(line)

def main():
    """主循环"""
    while True:
        msg = read_message()
        if msg is None:
            break

        if msg['type'] == 'start':
            execution_id = msg['executionId']

            # 发送输出
            send_message({
                'type': 'output',
                'executionId': execution_id,
                'level': 'INFO',
                'message': 'Starting Python skill',
            })

            # 请求执行 APDU
            send_message({
                'type': 'skill_action',
                'executionId': execution_id,
                'action': {
                    'id': 'select-applet',
                    'type': 'APDU',
                    'name': 'Select Applet',
                    'apdu': {
                        'cla': 0x00,
                        'ins': 0xA4,
                        'p1': 0x00,
                        'p2': 0x00,
                        'data': [0xA0, 0x00, 0x00, 0x00, 0x01, 0x01],
                    },
                },
            })

        elif msg['type'] == 'action_result':
            if msg.get('success'):
                send_message({
                    'type': 'execution_finished',
                    'executionId': msg['executionId'],
                    'status': 'SUCCESS',
                })
            else:
                send_message({
                    'type': 'execution_finished',
                    'executionId': msg['executionId'],
                    'status': 'FAILED',
                    'error': msg.get('error', 'Unknown error'),
                })

        elif msg['type'] == 'stop':
            break

if __name__ == '__main__':
    main()
```

## 跨语言 IPC 协议

Skill 和 Runtime 之间通过 JSON Lines（每行一个 JSON 对象）进行通信。

### Skill → Runtime 消息

**1. 请求执行 Action**

```json
{
  "type": "skill_action",
  "executionId": "exec-123",
  "action": {
    "id": "card.reset",
    "type": "RESET_CARD",
    "name": "Reset Card"
  }
}
```

**2. 输出事件**

```json
{
  "type": "output",
  "executionId": "exec-123",
  "level": "INFO",
  "message": "Card reset successful",
  "data": { "atr": "3B..." }
}
```

**3. 执行完成**

```json
{
  "type": "execution_finished",
  "executionId": "exec-123",
  "status": "SUCCESS",
  "data": { "result": "..." }
}
```

### Runtime → Skill 消息

**1. 开始执行**

```json
{
  "type": "start",
  "executionId": "exec-123",
  "skillId": "my.skill",
  "input": { "key": "value" },
  "cardSession": {
    "readerId": "reader-1",
    "atr": "3B...",
    "connected": true
  }
}
```

**2. Action 结果**

```json
{
  "type": "action_result",
  "executionId": "exec-123",
  "actionId": "card.reset",
  "actionType": "RESET_CARD",
  "success": true,
  "atr": "3B..."
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

## 设计文档

完整设计参见：`docs-smartcard/SmartCard_Agent_Skills_Desgin_v2.4.md`

## 示例

- **scp02.open** - Node.js/TypeScript 实现的 SCP02 安全通道建立
- **read.iccid** - Python 实现的 SIM 卡 ICCID 读取

## 注意事项

1. **进程隔离**：所有 Skill 在独立子进程中运行，崩溃不影响主进程
2. **环境变量**：Python Skill 可通过 `SKILL_EXECUTION_ID`、`SKILL_PACKAGE_PATH` 获取执行上下文
3. **错误处理**：Skill 崩溃或超时会导致 `FAILED` 状态，错误信息在 `error` 字段
4. **资源清理**：Runtime 会自动管理子进程生命周期，无需手动清理
