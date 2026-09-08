# SmartCard Agent Skills：多语言 Runtime 架构补充

**版本：v2.4**  
**基于：v2.3**

## 1. 目标

SmartCard Agent 的 Skill 可以由不同语言实现，例如 Java、Python。Agent 不应关心 Skill 使用哪种语言，只负责发起 Skill Execution、接收过程 Output/Event 与最终 Execution Result。

核心原则：

> **Agent 负责调用 Skill；Skill 负责协议逻辑；Runtime 负责 Skill 如何运行。**

## 2. 多语言模型

```text
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
              JavaHost          PythonHost
                  |                  |
                  v                  v
                 JRE              Python
                  |                  |
                  +--------+---------+
                           |
                           v
                   Skill Runtime API
```

Agent 不直接执行：

```text
java -jar xxx.jar
python xxx.py
```

而是：

```text
Agent -> SkillRuntime -> SkillHost
```

## 3. Skill Definition

建议每个 Skill package 包含 `skill.json`：

```json
{
  "skillId": "scp02.open",
  "version": "1.0.0",
  "runtime": {
    "type": "java",
    "version": "8+"
  },
  "entry": "com.example.skills.Scp02OpenSkill"
}
```

Python 示例：

```json
{
  "skillId": "read.iccid",
  "version": "1.0.0",
  "runtime": {
    "type": "python",
    "version": "3.10+"
  },
  "entry": "main.py"
}
```

`runtime` 是 Runtime 的部署元数据，Agent 业务层不依赖它。

## 4. Java Skill 的运行方式

### 4.1 MVP

如果桌面 Agent 本身就是 Java，可以优先使用 In-Process Java Host：

```text
Agent JVM
   |
   +-- SkillExecutor
           |
           +-- Java Skill
```

优点：简单、快、调试方便。

限制：Skill 与宿主 JVM 隔离较弱。

### 4.2 后续增强

需要更强隔离时，再增加：

```text
ProcessJavaHost
```

由独立 JVM 执行 Skill。

## 5. Python Skill

Python Skill 建议独立进程运行：

```text
PythonHost
   |
   +-- Python executable
   +-- Skill package
```

原因是这样不会要求 Java Agent 把 Python 嵌入同一个 JVM。

## 6. SkillHost 抽象

推荐定义：

```java
public interface SkillHost {

    SkillExecutionHandle start(
        SkillDefinition definition,
        SkillInput input,
        SkillContext context
    );

    void stop(String executionId);
}
```

实现：

```text
InProcessJavaHost
ProcessJavaHost
ProcessPythonHost
```

SkillExecutor 不应该判断语言，而应该由 SkillRuntime 根据 Definition 选择 Host。

## 7. 跨语言协议

跨语言的核心不是共享 Java Class，而是共享执行语义：

```text
START
  |
  v
SkillResult
  |
  +-- CONTINUE -> Action
  |
  v
ActionResult
  |
  v
SkillResult
  |
  +-- SUCCESS / FAILED / CANCELLED
```

旁路：

```text
SkillOutput -> EventStream -> Agent UI
```

### 7.1 示例：Skill 请求 RESET

```json
{
  "type": "skill_result",
  "status": "CONTINUE",
  "action": {
    "id": "card.reset",
    "type": "RESET_CARD",
    "name": "Reset Card"
  }
}
```

### 7.2 Runtime 返回 RESET 结果

```json
{
  "type": "action_result",
  "actionId": "card.reset",
  "actionType": "RESET_CARD",
  "success": true,
  "atr": "3B..."
}
```

### 7.3 最终结果

```json
{
  "type": "execution_finished",
  "status": "SUCCESS"
}
```

## 8. SkillContext 的跨语言映射

Java：

```java
ctx.output().info("Start SCP02");
```

Python：

```python
ctx.output.info("Start SCP02")
```

底层都转成统一的 Event：

```json
{
  "type": "output",
  "level": "INFO",
  "message": "Start SCP02"
}
```

## 9. Skill 包与环境管理

建议 package：

```text
skills/
  scp02.open/
    skill.json
    scp02-open.jar
    lib/

  read.iccid/
    skill.json
    main.py
    requirements.txt
```

第一阶段不要让 Skill Runtime 自动修改系统 Python/JRE 环境，也不要自动执行任意安装脚本。

建议启动前检查：

```text
runtime exists
version satisfies requirement
package exists
entry exists
```

## 10. 与 Agent 的最终边界

Agent：

```text
skillId
input
start/stop
EventStream
SkillExecutionResult
```

Runtime：

```text
language detection
host lifecycle
process lifecycle
IPC
environment validation
```

Skill：

```text
protocol logic
session/state
action construction
action result processing
output
```

## 11. 第一阶段推荐方案

最小实现：

```text
Java Agent
 |
 +-- InProcessJavaHost
 |
 +-- Java Skills
```

第二阶段：

```text
ProcessPythonHost
 |
 +-- Python Skills
```

第三阶段再统一 Skill Package / Runtime Protocol / Environment Manager。

当前版本不需要：

```text
DSL
动态代码注入
远程 Skill
分布式 Skill 调度
```
