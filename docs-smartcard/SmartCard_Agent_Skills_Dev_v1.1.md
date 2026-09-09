# SmartCard Agent Skills 开发手册

**版本：v1.1**

## 1. Skill 的定位

Skill 是一个完整的 SmartCard 操作能力，例如：

```text
scp02.open
scp02.close
read.iccid
read.imsi
pin.verify
profile.load
profile.install
```

Skill 作者负责协议逻辑；Runtime 负责执行基础设施。

## 2. 开发者必须理解的核心对象

```text
Skill
SkillSession
SkillState
SkillResult
SkillAction
ActionResult
SkillOutput
SkillContext
```

核心执行闭环：

```text
Skill.start()
    |
    v
SkillResult(CONTINUE, Action)
    |
    v
Runtime executes Action
    |
    v
ActionResult
    |
    v
Skill.handleResult()
    |
    v
SkillResult
```

## 3. SkillResult

`SkillResult` 是控制流对象，表示 Skill 当前这一轮要 Runtime 做什么。

建议：

```java
public final class SkillResult {
    private final SkillStatus status;
    private final SkillAction nextAction;
    private final Throwable error;
}
```

### CONTINUE

必须有 `nextAction`：

```java
return SkillResult.continueWith(
    ResetCardAction.create()
);
```

### SUCCESS

表示本次 Skill 完成。

### FAILED

表示本次 Skill 失败。

### CANCELLED

表示执行被取消。

本版本不支持从中间 Resume。

## 4. Action

Action 是 Skill 请求 Runtime 执行的操作。

当前类型：

```text
APDU
RESET_CARD
CONNECT_READER
DISCONNECT_READER
WAIT
DELAY
CUSTOM
```

Action 不应该等同于“APDU”。例如：

```java
ResetCardAction.create()
```

也是合法 SkillAction。

## 5. ActionResult

ActionResult 是 Runtime 执行 Action 后返回给 Skill 的事实。

```text
ApduAction
    -> ApduActionResult

ResetCardAction
    -> ResetCardResult
```

Skill 应根据 Result 更新 Session，并决定下一步：

```java
ResetCardResult reset =
    result.require(ResetCardResult.class);
```

## 6. SkillOutput

Output 与 Result 完全分离。

Output 是过程中的展示信息：

```java
ctx.output().info("开始执行 SCP02");
ctx.output().text("发送 Initialize Update");
ctx.output().data(parsedData);
ctx.output().stream("正在计算 Session Key...\n");
```

这些信息通过 EventStream 到 Agent UI。

不要把过程日志塞进 `SkillResult`。

## 7. Session

Session 只保存本次 Execution 的动态状态：

```java
class Scp02Session {
    Scp02State state;
    byte[] hostChallenge;
    byte[] cardChallenge;
    byte[] sequenceCounter;
    byte[] sessionEncKey;
    byte[] sessionMacKey;
}
```

Skill 对象不要保存本次 Session：

```java
// 不推荐
class Scp02Skill {
    private Scp02Session session;
}
```

## 8. State

推荐使用语义状态：

```java
enum Scp02State {
    START,
    WAIT_RESET,
    WAIT_INITIALIZE_UPDATE,
    WAIT_EXTERNAL_AUTHENTICATE,
    ESTABLISHED,
    FAILED
}
```

不要用：

```java
int step = 1;
```

## 9. 简单 Skill

单条 APDU 的 Skill 可以继承 SDK 提供的 `SimpleApduSkill`，减少样板代码。

概念：

```text
build APDU
   |
   v
APDU
   |
   v
Response
   |
   v
parse
   |
   v
SUCCESS
```

## 10. 复杂 Skill

SCP02、SCP80、Secure Messaging、Profile Download 应直接实现完整 `Skill<S>`。

原因：这些协议通常需要：

```text
多步交互
前后状态依赖
Response 解析
密码学计算
条件判断
```

## 11. 推荐标准模板

```java
public final class XxxSkill
        implements Skill<XxxSession> {

    @Override
    public XxxSession createSession(
            SkillContext ctx,
            SkillInput input) {
        return new XxxSession(input);
    }

    @Override
    public SkillResult start(
            SkillContext ctx,
            XxxSession session) {
        return SkillResult.continueWith(...);
    }

    @Override
    public SkillResult handleResult(
            SkillContext ctx,
            ActionResult result,
            XxxSession session) {
        // parse result
        // update state
        // return next action
    }
}
```

## 12. 一个 Action 的描述信息

建议：

```java
ApduAction.builder()
    .id("scp02.initialize-update")
    .name("Initialize Update")
    .description("获取 Sequence Counter、Card Challenge 等数据")
    .apdu(apdu)
    .sensitive(false)
    .build();
```

这些信息可以直接用于 Agent UI 和执行 Trace。

## 13. Response 解析原则

需要参与后续计算的数据必须进入 Session：

```java
session.setCardChallenge(...);
session.setSequenceCounter(...);
```

同时可以输出：

```java
ctx.output().data(parsedResult);
```

即：

```text
Session -> 给 Skill 后续逻辑
Output  -> 给 Agent/UI
```

## 14. 密钥安全

不要输出：

```text
ENC KEY
MAC KEY
KEK
SESSION ENC KEY
SESSION MAC KEY
```

可以输出：

```text
keyVersion
securityLevel
algorithm
```

生产实现建议使用安全密钥对象或引用，不要在大量对象之间复制原始 key bytes。

## 15. 一次 Execution

当前版本执行模型：

```text
START
  |
  v
RUNNING
  |
  +---- ACTION / ACTION RESULT ----+
  |                                |
  +--------------------------------+
  |
  v
SUCCESS / FAILED / CANCELLED
```

失败后再次尝试就是创建新的 Execution，而不是从中间继续。

## 16. 多语言 Skill

Skill 可以用 Java 或 Python 实现。

Agent 只看到：

```text
skillId
input
result
output/events
```

Java/Python 的启动方式由 Runtime Host 管理。

## 17. 开发完成检查

```text
[ ] SkillId 明确
[ ] Session 为本次执行独立实例
[ ] State 语义明确
[ ] 不直接操作 Reader
[ ] Action 类型明确
[ ] ActionResult 正确处理
[ ] SkillResult 只负责控制流
[ ] Output 与 Result 分离
[ ] 敏感信息脱敏
[ ] 成功/失败边界明确
[ ] 简单 Skill 使用便利基类
[ ] 复杂协议使用显式状态机
```
