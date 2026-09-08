# SmartCard Agent Skills 完整架构设计方案

**版本：v2.3**  
**定位：桌面端 SmartCard Agent Skill Runtime**  
**适用范围：SCP02、SCP80、GlobalPlatform、Secure Messaging、Load/Install、卡片管理、APDU 脚本与其他 SmartCard 操作 Skill**

---

## 1. 文档目的

本文定义 SmartCard Agent 中 Skills 的统一执行模型，重点解决以下问题：

1. 一个 Skill 可能由多个步骤组成，后续步骤依赖前一步执行结果。
2. Skill 产生的操作不一定是 APDU，也可能是 Reset Card、Connect、Wait 等运行时动作。
3. Skill 需要在执行过程中向 Agent 输出日志、解析信息、状态信息，并支持字符串和流式输出。
4. Skill 需要保存本次执行过程中的动态状态，例如 SCP02 的 Challenge、Sequence Counter、Session Key 等。
5. Skill 的执行结果与执行过程中的输出必须严格分离。
6. Skill 执行按照“一次执行从头开始，到成功或失败结束”的模型设计，当前版本不考虑中途 Resume、Rollback、Checkpoint 和 Skill Retry。
7. 当前产品是桌面端测试/验证工具，主要场景是一台设备连接一张卡，因此当前版本不设计复杂的多 Reader、多 Card 并发调度体系。
8. Skill 作者需要完整控制 SmartCard 协议逻辑，Runtime 不应为了简化 API 而隐藏协议细节。
9. 当前版本不引入 DSL，也不实现运行时动态修改 Skill 代码或动态注入逻辑。

---

# 2. 核心设计原则

## 2.1 Skill 是协议逻辑的拥有者

Skill 作者负责：

- APDU 构造
- APDU 执行顺序
- Response 解析
- 协议状态管理
- 密钥计算
- 条件判断
- 下一步操作决定
- 最终业务结果生成

例如 SCP02 的：

```text
RESET
↓
SELECT
↓
INITIALIZE UPDATE
↓
解析 Response
↓
派生 Session Key
↓
计算 Host Cryptogram
↓
EXTERNAL AUTHENTICATE
```

这些逻辑属于 Skill，而不是 Runtime。

## 2.2 Runtime 负责如何运行

Runtime 负责：

- 创建 Skill Session
- 调用 Skill
- 执行 Skill 产生的 Action
- 将 ActionResult 返回给 Skill
- 管理 Skill 生命周期
- 管理 Reader / Card 的运行环境
- 统一事件输出
- 异常边界处理
- 基础超时与取消能力

Runtime 不负责理解 SCP02、SCP80 等具体协议含义。

## 2.3 Result 与 Output 完全分离

这是本方案最重要的设计原则之一。

```text
SkillResult
    = 控制执行流程

SkillOutput
    = 执行过程中的信息输出
```

`SkillResult` 决定 Runtime 下一步做什么；`SkillOutput` 仅用于向 Agent/UI 展示或记录信息，不参与 Skill 控制流。

## 2.4 Action 与 ActionResult 配对

```text
SkillResult
    ↓
SkillAction
    ↓
ActionExecutor
    ↓
ActionResult
    ↓
Skill
```

其中：

- `SkillAction`：Skill 要求 Runtime 执行什么。
- `ActionResult`：Runtime 执行后实际得到了什么。

## 2.5 一次 Skill Execution 从头开始到结束

当前版本采用：

```text
NEW
 ↓
RUNNING
 ↓
SUCCESS / FAILED / CANCELLED
```

不实现：

- 中途 Resume
- Checkpoint
- Rollback
- Skill Retry
- 持久化恢复

一次执行失败，需要重新创建一次新的 Skill Execution。

> 这里的“事务性”表示执行实例的生命周期完整性，并不表示 SmartCard 的实际操作可以数据库式 Rollback。

## 2.6 当前版本采用单卡桌面 Agent 模型

当前主要场景：

```text
Desktop Agent
    ↓
Reader
    ↓
One Card
    ↓
One Active Skill Execution
```

暂不设计复杂的：

- 多卡调度
- Reader Pool
- 分布式锁
- 多卡并行执行
- CardSession 级任务队列

但可以保留一个简单约束：**同一时间一个 CardSession 只有一个 Active Skill Execution。**

---

# 3. 总体架构

```text
                         ┌─────────────────┐
                         │      Agent      │
                         └────────┬────────┘
                                  │
                                  ▼
                        ┌────────────────────┐
                        │   SkillExecutor    │
                        └─────────┬──────────┘
                                  │
                                  ▼
                        ┌────────────────────┐
                        │       Skill        │
                        └─────────┬──────────┘
                                  │
                  ┌───────────────┼────────────────┐
                  │               │                │
                  ▼               ▼                ▼
            SkillSession     SkillResult      SkillOutput
                  │               │                │
                  │               ▼                ▼
                  │          SkillAction      EventStream
                  │               │                │
                  │               ▼                └────→ Agent UI
                  │        ActionExecutor
                  │               │
                  │               ▼
                  │         ActionResult
                  │               │
                  └───────────────┴────────────→ Skill

                          CardSession
                               │
                               ▼
                             Reader
```

---

# 4. 核心对象职责

| 对象                      | 职责                                      |
| ------------------------- | ----------------------------------------- |
| `Skill`                   | 定义具体协议和业务逻辑                    |
| `SkillSession`            | 保存本次执行的动态状态                    |
| `SkillState`              | 保存 Skill 当前协议状态                   |
| `SkillResult`             | Skill 当前调用完成后的执行控制结果        |
| `SkillAction`             | Skill 请求 Runtime 执行的动作             |
| `ActionExecutor`          | 实际执行 Action                           |
| `ActionResult`            | Action 执行后的实际结果                   |
| `SkillOutput`             | Skill 执行过程中主动产生的展示/诊断信息   |
| `SkillEvent`              | Output 的统一事件模型                     |
| `EventStream`             | 将事件实时传给 Agent/UI                   |
| `SkillExecutionResult<T>` | 整个 Skill Execution 完成后的最终业务结果 |
| `SkillContext`            | 给 Skill 提供受控运行能力                 |
| `CardSession`             | 保存当前 Card 的运行上下文                |
| `Reader`                  | 底层读卡器实现                            |
| `SkillExecutor`           | 驱动整个 Skill Execution 生命周期         |

---

# 5. Skill 接口设计

推荐核心接口：

```java
public interface Skill<S> {

    /**
     * 创建本次执行独立的 Session。
     */
    S createSession(SkillContext context, SkillInput input);

    /**
     * 启动 Skill。
     */
    SkillResult start(
        SkillContext context,
        S session
    );

    /**
     * 处理 Runtime 执行 Action 后返回的结果。
     */
    SkillResult handleResult(
        SkillContext context,
        ActionResult result,
        S session
    );
}
```

这里不保留 `nextCommand()` 和 `handleResponse()` 作为核心接口，因为 Skill 的输出不一定是 APDU。

Skill 的统一执行模型是：

```text
SkillResult
    ↓
SkillAction
    ↓
ActionResult
    ↓
Skill.handleResult()
```

---

# 6. SkillSession

`SkillSession` 表示**一次 Skill Execution 的动态状态**。

```java
public interface SkillSession {

    String getSessionId();

    String getSkillId();

    SessionStatus getStatus();
}
```

具体 Skill 定义自己的 Session。

例如：

```java
public final class Scp02Session implements SkillSession {

    private Scp02State state;

    private byte[] hostChallenge;
    private byte[] cardChallenge;
    private byte[] sequenceCounter;

    private int keyVersion;
    private int keyIdentifier;

    private SecurityContext securityContext;

    // getters / setters
}
```

Session 只代表当前执行，不承担长期任务恢复职责。

---

# 7. SkillState

不建议使用：

```java
int step;
```

推荐使用明确的状态：

```java
public enum Scp02State {
    START,
    WAIT_RESET,
    WAIT_INITIALIZE_UPDATE,
    WAIT_EXTERNAL_AUTHENTICATE,
    ESTABLISHED,
    FAILED
}
```

Session 保存当前状态：

```java
session.setState(Scp02State.WAIT_INITIALIZE_UPDATE);
```

Skill 的下一步逻辑由：

```text
当前 State + ActionResult
```

共同决定，而不是只根据 SW 判断当前步骤。

---

# 8. SkillResult：执行控制结果

## 8.1 定义

`SkillResult` 表示：

> **Skill 这一次调用完成后，希望 Runtime 下一步怎么执行。**

推荐：

```java
public final class SkillResult {

    private final SkillStatus status;
    private final SkillAction nextAction;
    private final SkillError error;

    public static SkillResult continueWith(
        SkillAction action
    ) {
        return new SkillResult(
            SkillStatus.CONTINUE,
            action,
            null
        );
    }

    public static SkillResult success() {
        return new SkillResult(
            SkillStatus.SUCCESS,
            null,
            null
        );
    }

    public static SkillResult failed(
        SkillError error
    ) {
        return new SkillResult(
            SkillStatus.FAILED,
            null,
            error
        );
    }
}
```

状态：

```java
public enum SkillStatus {
    CONTINUE,
    SUCCESS,
    FAILED,
    CANCELLED
}
```

## 8.2 SkillResult 的语义

### CONTINUE

表示：

```text
Skill 还没有完成
 ↓
需要 Runtime 执行 nextAction
```

例如：

```java
return SkillResult.continueWith(
    ResetCardAction.create()
);
```

### SUCCESS

表示整个 Skill Execution 已完成。

```java
return SkillResult.success();
```

最终业务结果由 `SkillExecutionResult<T>` 承载，而不是塞进 `SkillResult.output`。

### FAILED

表示 Skill Execution 失败。

### CANCELLED

表示当前执行被主动取消。

---

# 9. SkillAction

## 9.1 为什么不能继续使用 Command

如果核心模型只有：

```java
Command
```

就意味着 Skill 只能要求 Runtime：

```text
发送 APDU
```

但实际 Skill 可能需要：

```text
RESET
CONNECT
DISCONNECT
APDU
WAIT
DELAY
CUSTOM
```

因此统一抽象为：

```java
public interface SkillAction {

    String getActionId();

    ActionType getType();
}
```

## 9.2 ActionType

```java
public enum ActionType {
    APDU,
    RESET_CARD,
    CONNECT_READER,
    DISCONNECT_READER,
    WAIT,
    DELAY,
    CUSTOM
}
```

第一版可以只实现：

```text
APDU
RESET_CARD
```

其他类型按实际需求逐步加入。

---

# 10. APDU Action

```java
public final class ApduAction implements SkillAction {

    private final String actionId;
    private final byte[] apdu;
    private final String name;
    private final String description;
    private final boolean sensitive;
}
```

一个 APDU Action 不只携带：

```text
APDU Bytes
```

还可以携带：

```text
Name
Description
Step ID
Sensitive 标识
Metadata
```

例如：

```java
ApduAction.builder()
    .actionId("scp02.initialize-update")
    .name("Initialize Update")
    .description("获取 SCP02 所需初始化数据")
    .apdu(apdu)
    .sensitive(true)
    .build();
```

这样 Agent UI 可以展示：

```text
Initialize Update
发送 INITIALIZE UPDATE
APDU: 8050...
```

而 Runtime 不需要理解 SCP02 的语义。

---

# 11. Reset Action

RESET 不应该被强行包装成 APDU。

```java
public final class ResetCardAction
        implements SkillAction {

    private final String actionId;

    @Override
    public ActionType getType() {
        return ActionType.RESET_CARD;
    }
}
```

Skill：

```java
return SkillResult.continueWith(
    ResetCardAction.create()
);
```

Runtime：

```text
ResetCardAction
     ↓
Reader.reset()
     ↓
ResetCardResult
```

---

# 12. ActionResult：Action 执行事实

## 12.1 定义

`ActionResult` 表示：

> **Runtime 刚才执行的 Action 实际产生了什么结果。**

基础接口：

```java
public interface ActionResult {

    String getActionId();

    ActionType getActionType();

    boolean isSuccess();

    SkillError getError();
}
```

## 12.2 不同 Action 使用不同 Result

### APDU

```java
public final class ApduActionResult
        implements ActionResult {

    private final Response response;
}
```

### RESET

```java
public final class ResetCardResult
        implements ActionResult {

    private final byte[] atr;
}
```

### CONNECT

```java
public final class ConnectResult
        implements ActionResult {

    private final ReaderInfo reader;
}
```

因此：

```text
APDU Action
    ↓
ApduActionResult

RESET Action
    ↓
ResetCardResult
```

## 12.3 ActionResult 与 SkillResult 的本质区别

这是整个设计最核心的概念之一：

```text
ActionResult = Fact
```

表示：

> Runtime 刚才实际发生了什么？

而：

```text
SkillResult = Decision
```

表示：

> Skill 根据这个事实决定下一步做什么？

例如：

```text
ResetCardAction
      ↓
Reader.reset()
      ↓
ResetCardResult(ATR)
      ↓
Skill
      ↓
SkillResult(CONTINUE + InitializeUpdateAction)
```

---

# 13. SkillOutput：过程输出

## 13.1 定义

SkillOutput 与 SkillResult 完全独立。

它表示：

> **Skill 执行过程中主动向 Agent/UI 输出的信息。**

例如：

```text
开始执行 SCP02
Reset Card
ATR = 3B...
Initialize Update 完成
Sequence Counter = 0012
正在计算 Session Key...
External Authenticate 成功
```

这些不是控制流，不应该放进 `SkillResult`。

## 13.2 输出接口

推荐：

```java
public interface SkillOutputSink {

    void text(String text);

    void info(String text);

    void warn(String text);

    void error(String text);

    void data(Object data);

    void stream(String chunk);
}
```

Skill：

```java
ctx.output().info("开始执行 SCP02");

ctx.output().text("Initialize Update");

ctx.output().data(parsedData);

ctx.output().stream("正在计算 Session Key...");
```

---

# 14. SkillEvent / EventStream

Runtime 将 Output 统一转成事件：

```java
public interface SkillEvent {

    String getExecutionId();

    String getSkillId();

    String getSessionId();

    SkillEventType getType();

    Instant getTimestamp();

    Object getPayload();
}
```

事件类型可以包括：

```java
public enum SkillEventType {
    LOG,
    STREAM,
    DATA,
    WARNING,
    ERROR,
    ACTION_STARTED,
    ACTION_COMPLETED,
    STATE_CHANGED,
    PROGRESS
}
```

Agent UI 可以订阅：

```text
EventStream
    ↓
Agent Frontend
```

例如：

```text
[INFO] 开始执行 SCP02
[ACTION] RESET_CARD
[DATA] ATR = 3B9F...
[ACTION] INITIALIZE_UPDATE
[DATA] Sequence Counter = 0012
[STREAM] 正在计算 Session Key...
[ACTION] EXTERNAL_AUTHENTICATE
[SUCCESS] SCP02 Channel Established
```

---

# 15. SkillExecutionResult：最终业务结果

因为 `SkillResult` 负责控制流程，所以不要把最终业务结果塞到其中。

推荐定义：

```java
public final class SkillExecutionResult<T> {

    private final SkillStatus status;
    private final T output;
    private final SkillError error;
}
```

例如 SCP02：

```java
public final class Scp02Result {

    private final boolean established;
    private final int securityLevel;
    private final int keyVersion;
}
```

最终：

```text
SkillResult.SUCCESS
        ↓
SkillExecutionResult<Scp02Result>
```

因此整个体系变成：

```text
SkillResult
    → 每一轮执行控制

ActionResult
    → 每一次 Action 的实际结果

SkillOutput
    → 执行过程中的展示信息

SkillExecutionResult<T>
    → 整个 Skill 的最终业务结果
```

---

# 16. SkillContext

推荐：

```java
public interface SkillContext {

    CardSession cardSession();

    SkillOutputSink output();

    CryptoService crypto();

    SkillLogger logger();
}
```

Skill 不直接持有 `Reader`。

如果 Skill 不需要主动访问 Reader，则无需暴露 Reader API。

Action 的实际执行由 Runtime 完成。

---

# 17. Reader 与 CardSession

## 17.1 Reader

Reader 表示：

```text
PCSC Reader
USB Reader
Serial Reader
```

是底层设备。

## 17.2 CardSession

CardSession 表示当前卡的运行上下文：

```java
public final class CardSession {

    private String readerId;
    private byte[] atr;
    private Protocol protocol;

    private SecureChannelContext secureChannel;

    private String selectedApplication;
}
```

特别需要注意：

```text
RESET
```

可能导致：

```text
ATR 更新
Secure Channel 失效
Selected Application 失效
```

因此 Runtime 在执行 `ResetCardAction` 后，应同步更新 CardSession 的基础状态。

---

# 18. SkillExecutor

核心执行器：

```java
public final class SkillExecutor {

    public <S, T> SkillExecutionResult<T> execute(
        Skill<S> skill,
        SkillContext context,
        SkillInput input
    ) {

        S session =
            skill.createSession(context, input);

        SkillResult result;

        try {
            result = skill.start(context, session);

            while (result.getStatus() == SkillStatus.CONTINUE) {

                ActionResult actionResult =
                    executeAction(
                        result.getNextAction(),
                        context
                    );

                result = skill.handleResult(
                    context,
                    actionResult,
                    session
                );
            }

            return buildFinalResult(result, session);

        } catch (Exception e) {
            return handleExecutionException(e, session);
        }
    }
}
```

Runtime 不负责理解：

```text
SCP02
SCP80
Load
Install
```

只负责驱动生命周期。

---

# 19. 完整 SCP02 示例

假设流程：

```text
RESET
 ↓
INITIALIZE UPDATE
 ↓
DERIVE SESSION KEY
 ↓
EXTERNAL AUTHENTICATE
 ↓
SUCCESS
```

Skill：

```java
public final class Scp02OpenSkill
        implements Skill<Scp02Session> {

    @Override
    public Scp02Session createSession(
        SkillContext ctx,
        SkillInput input
    ) {
        Scp02Session session =
            new Scp02Session(input.getKeyConfig());

        session.setHostChallenge(
            ctx.crypto().randomBytes(8)
        );

        return session;
    }

    @Override
    public SkillResult start(
        SkillContext ctx,
        Scp02Session session
    ) {

        ctx.output().info("开始执行 SCP02");

        session.setState(
            Scp02State.WAIT_RESET
        );

        return SkillResult.continueWith(
            ResetCardAction.create()
        );
    }

    @Override
    public SkillResult handleResult(
        SkillContext ctx,
        ActionResult result,
        Scp02Session session
    ) {

        switch (session.getState()) {

            case WAIT_RESET:

                ResetCardResult reset =
                    result.require(ResetCardResult.class);

                session.setAtr(reset.getAtr());

                ctx.output().data(
                    "ATR = " + hex(reset.getAtr())
                );

                session.setState(
                    Scp02State.WAIT_INITIALIZE_UPDATE
                );

                return SkillResult.continueWith(
                    ApduAction.of(
                        buildInitializeUpdate(session)
                    )
                );

            case WAIT_INITIALIZE_UPDATE:

                ApduActionResult init =
                    result.require(
                        ApduActionResult.class
                    );

                parseInitializeUpdate(
                    init.getResponse(),
                    session
                );

                deriveSessionKeys(session);

                ctx.output().info(
                    "Initialize Update 完成"
                );

                session.setState(
                    Scp02State.WAIT_EXTERNAL_AUTHENTICATE
                );

                return SkillResult.continueWith(
                    ApduAction.of(
                        buildExternalAuthenticate(session)
                    )
                );

            case WAIT_EXTERNAL_AUTHENTICATE:

                ApduActionResult auth =
                    result.require(
                        ApduActionResult.class
                    );

                verifyAuthentication(
                    auth.getResponse(),
                    session
                );

                session.setState(
                    Scp02State.ESTABLISHED
                );

                ctx.output().info(
                    "SCP02 Channel Established"
                );

                return SkillResult.success();

            default:
                return SkillResult.failed(
                    new SkillError("Unexpected SCP02 state")
                );
        }
    }
}
```

注意这里：

```text
SkillResult
```

没有任何 Output。

Output 全部通过：

```java
ctx.output()
```

发送。

---

# 20. SCP02 中插入 RESET 的执行流程

最终流程：

```text
Skill.start()
     │
     ▼
SkillResult
CONTINUE + ResetCardAction
     │
     ▼
Runtime
     │
     ▼
Reader.reset()
     │
     ▼
ResetCardResult
     │
     ▼
Skill.handleResult()
     │
     ├── 更新 Session ATR
     ├── 输出日志
     └── 创建 Initialize Update Action
     │
     ▼
SkillResult
CONTINUE + ApduAction
     │
     ▼
Runtime
     │
     ▼
Reader.transmit()
     │
     ▼
ApduActionResult
     │
     ▼
Skill.handleResult()
```

这个模型不要求 RESET 伪装成 APDU。

---

# 21. APDU Response 与解析信息

APDU Response 本身只表示卡实际返回的数据：

```java
public final class Response {

    private final byte[] data;
    private final int sw;
}
```

Skill 可以自行解析：

```java
InitializeUpdateInfo info =
    parseInitializeUpdate(response);
```

解析得到的信息属于 Skill 的领域数据：

```text
Sequence Counter
Card Challenge
Card Cryptogram
Key Version
```

如果需要展示给 Agent UI，可以同时：

```java
ctx.output().data(info);
```

因此同一份信息可以：

```text
保存到 Session → 支持后续协议计算

输出到 EventStream → 支持 UI 展示
```

二者职责不同。

---

# 22. 输出模型：字符串与流式统一

Skill 输出分为两类：

### 普通输出

```java
ctx.output().info("开始执行");
```

### 流式输出

```java
ctx.output().stream("正在");
ctx.output().stream("计算");
ctx.output().stream(" Session Key...");
```

Runtime 统一生成：

```text
SkillEvent
```

Agent UI 可以根据事件类型进行：

- 实时日志展示
- Streaming 文本显示
- 结构化数据展示
- APDU Trace 展示
- State 展示
- Warning/Error 展示

---

# 23. 日志与安全

日志应该能够展示足够的调试信息，但不能泄露敏感密钥。

允许：

```text
keyVersion
securityLevel
algorithm
sequenceCounter
```

谨慎/脱敏：

```text
APDU Data
Response Data
Cryptogram
```

禁止普通日志直接输出：

```text
ENC KEY
MAC KEY
KEK KEY
SESSION KEY
```

建议通过：

```java
SkillLogger
SecurityFilter
```

统一控制日志内容。

---

# 24. SecurityContext

由于 SCP02 会产生敏感密钥，建议：

```text
Scp02Session
├── protocolState
├── challenge
├── sequenceCounter
└── SecurityContext
      ├── static keys
      └── session keys
```

推荐：

```java
public interface SecurityContext {

    KeyReference encKey();

    KeyReference macKey();

    KeyReference kekKey();
}
```

第一版也可以在严格受控的内存范围内使用 `SecretKey`。

原则是：

> 普通协议状态可以正常管理；敏感密钥必须避免进入普通日志、普通输出和普通持久化结构。

当前版本不要求实现 HSM 或复杂密钥服务。

---

# 25. 异常处理

Skill 内部异常由 Executor 统一处理。

建议：

```text
SkillException
├── SkillValidationException
├── ActionExecutionException
├── ProtocolException
├── SecurityException
├── TimeoutException
└── SkillCancelledException
```

执行流程：

```text
Skill.start()/handleResult()
        ↓
Exception
        ↓
SkillExecutor
        ↓
捕获
        ↓
生成 ERROR Event
        ↓
更新 Execution 状态
        ↓
SkillExecutionResult.FAILED
```

同时保留原始 Cause 供开发调试：

```java
SkillExecutionException
    └── cause = originalException
```

对 Agent/UI 暴露的错误信息应经过脱敏。

---

# 26. 超时与取消

虽然当前不做复杂 Retry/Resume，但仍建议支持基础：

```text
Timeout
Cancel
```

因为桌面应用中可能出现：

```text
Reader 无响应
Card 拔出
PCSC 阻塞
用户点击停止
```

这些属于 Runtime 基础能力，而不是 Skill Retry。

建议：

```java
SkillContext
    .isCancelled()
```

或者：

```java
CancellationToken
```

Skill 可以在长时间计算过程中主动结束。

---

# 27. 不设计 Retry / Resume / Rollback

当前版本明确不实现：

```text
Retry Framework
Checkpoint
Rollback
Resume
Persistent Execution
```

原因：

1. 桌面 Agent 的主要场景是一次性测试/验证。
2. SmartCard 操作很多情况下无法真正 Rollback。
3. 从中间恢复需要保存复杂的 Card 状态与协议状态。
4. 会明显增加 Skill Runtime 的复杂度。

失败后的重新执行模型：

```text
Execution #001
START
 ↓
FAILED

用户重新执行
 ↓
Execution #002
START
 ↓
...
```

每次都是新的 Session。

---

# 28. 并发模型

当前版本不设计复杂并发体系。

约束即可：

```text
One CardSession
    ↓
One Active SkillExecution
```

如果用户在当前 Skill 执行过程中再次发起 Skill，可以：

```text
拒绝
或
提示当前 Skill 正在执行
```

第一版无需引入：

```text
Reader Queue
Distributed Lock
Reader Pool
Card Scheduler
```

未来如果产品场景发生变化，再独立演进。

---

# 29. Skill Registry / Factory

如果 Agent 根据 Skill ID 调用 Skill，可以使用：

```java
public interface SkillRegistry {

    Skill<?> get(String skillId);
}
```

例如：

```text
scp02.open
scp02.load-install
scp80.open
pin.verify
read.iccid
read.imsi
profile.download
```

如果 Skill 有运行参数，可使用 Factory：

```java
public interface SkillFactory {

    Skill<?> create(SkillInput input);
}
```

调用：

```text
Agent
 ↓
skillId + input
 ↓
Registry
 ↓
Factory
 ↓
Skill
 ↓
Executor
```

Agent 不需要知道具体 Java 类名。

---

# 30. 简单 Skill 的样板问题

虽然核心接口是通用的，但简单 Skill 不应该产生过多样板代码。

建议 SDK 提供便利基类：

```java
SimpleApduSkill
```

适合：

```text
1 APDU
 ↓
1 Response
 ↓
1 Output
```

例如：

```java
public class ReadIccidSkill
        extends SimpleApduSkill {

    @Override
    protected ApduAction buildAction(
        SkillContext ctx,
        SkillInput input
    ) {
        return ApduAction.of(
            buildReadIccidApdu()
        );
    }

    @Override
    protected SkillExecutionResult<?> parse(
        ApduActionResult result
    ) {
        return success(
            parseIccid(result.getResponse())
        );
    }
}
```

这只是 SDK 的便利层，不改变底层 Runtime 模型。

对于 SCP02 等复杂协议，仍直接实现完整 `Skill<S>`。

---

# 31. 测试模型

## 31.1 Skill 单元测试

Skill 不依赖真实 Reader。

可以直接构造：

```text
ResetCardResult
ApduActionResult
Response
Scp02Session
```

测试：

- Response 解析
- Session 更新
- State 转换
- Cryptogram 计算
- 下一步 Action
- 非 9000 处理
- 异常处理

## 31.2 Action Executor 测试

使用：

```java
MockActionExecutor
```

模拟：

```text
RESET → ResetCardResult
APDU  → ApduActionResult
```

## 31.3 Event 测试

提供：

```java
RecordingEventStream
```

断言：

```text
INFO
ACTION_STARTED
DATA
ACTION_COMPLETED
SUCCESS
```

## 31.4 Replay Test

建议提供：

```java
RecordingActionExecutor
ReplayActionExecutor
```

用于保存和回放：

```text
Action
Result
Action
Result
...
```

这样可以在没有真实卡片的情况下复现协议流程。

---

# 32. 推荐 Java Package

```text
smartcard-agent/
│
├── skill/
│   ├── Skill.java
│   ├── SkillInput.java
│   ├── SkillResult.java
│   ├── SkillStatus.java
│   ├── SkillExecutionResult.java
│   ├── SkillContext.java
│   ├── SkillExecutor.java
│   └── SkillRegistry.java
│
├── session/
│   ├── SkillSession.java
│   ├── SessionStatus.java
│   └── CardSession.java
│
├── action/
│   ├── SkillAction.java
│   ├── ActionType.java
│   ├── ActionResult.java
│   ├── ActionExecutor.java
│   ├── ApduAction.java
│   ├── ApduActionResult.java
│   ├── ResetCardAction.java
│   └── ResetCardResult.java
│
├── apdu/
│   ├── Response.java
│   └── ApduChannel.java
│
├── output/
│   ├── SkillOutputSink.java
│   ├── SkillEvent.java
│   ├── SkillEventType.java
│   └── EventStream.java
│
├── reader/
│   ├── Reader.java
│   ├── PcscReader.java
│   └── MockReader.java
│
├── security/
│   ├── SecurityContext.java
│   ├── KeyReference.java
│   └── CryptoService.java
│
├── exception/
│   ├── SkillException.java
│   ├── ProtocolException.java
│   └── ActionExecutionException.java
│
└── skills/
    ├── scp02/
    │   ├── Scp02OpenSkill.java
    │   ├── Scp02Session.java
    │   ├── Scp02State.java
    │   └── Scp02Result.java
    │
    ├── scp80/
    ├── pin/
    └── profile/
```

---

# 33. 完整执行时序

```text
Agent
 │
 │ execute(skillId, input)
 ▼
SkillExecutor
 │
 │ createSession()
 ▼
SkillSession
 │
 │ start()
 ▼
Skill
 │
 │ SkillResult
 │ CONTINUE + Action
 ▼
ActionExecutor
 │
 │ execute(Action)
 ▼
Reader / System
 │
 │ ActionResult
 ▼
Skill
 │
 ├── 更新 Session
 ├── 解析 Result
 ├── SkillOutput → EventStream
 └── 生成 SkillResult
 │
 ├─────────────── CONTINUE ──────────────┐
 │                                       │
 │                                       ▼
 │                                    Action
 │                                       │
 │                                       └──→ ...
 │
 └──────────── SUCCESS / FAILED ─────────→ Execution End
```

---

# 34. SCP02 + Load & Install Applet

复杂 Skill 可以继续保持完整协议逻辑，例如：

```text
Scp02LoadInstallSkill
│
├── RESET
├── SELECT ISD
├── INITIALIZE UPDATE
├── Parse Response
├── Derive Session Keys
├── EXTERNAL AUTHENTICATE
├── Establish Secure Channel
├── LOAD
├── INSTALL FOR LOAD
├── INSTALL FOR INSTALL
└── SUCCESS
```

其中：

```text
SkillSession
```

保存：

```text
Card Challenge
Sequence Counter
Session Keys
Current State
AID
Load Parameters
Install Parameters
```

`SkillOutput` 输出：

```text
当前阶段
APDU 描述
Response 解析
进度
日志
Warning
Error
```

`SkillResult` 负责：

```text
下一步 Action
```

`ActionResult` 负责：

```text
实际返回结果
```

`SkillExecutionResult` 负责：

```text
最终 Load / Install 结果
```

---

# 35. 设计示例：SCP02 + Load/Install

简化流程：

```text
start()
 ↓
SkillResult(CONTINUE, ResetCardAction)
 ↓
ResetCardResult
 ↓
handleResult()
 ↓
SkillResult(CONTINUE, SelectAction)
 ↓
ApduActionResult
 ↓
handleResult()
 ↓
SkillResult(CONTINUE, InitializeUpdateAction)
 ↓
ApduActionResult
 ↓
解析 Card Challenge / Sequence Counter
 ↓
ctx.output().data(parsedInfo)
 ↓
派生 Session Key
 ↓
SkillResult(CONTINUE, ExternalAuthenticateAction)
 ↓
ApduActionResult
 ↓
建立 Secure Channel
 ↓
SkillResult(CONTINUE, LoadAction)
 ↓
...
 ↓
InstallAction
 ↓
Install Result
 ↓
SkillResult(SUCCESS)
 ↓
SkillExecutionResult<LoadInstallResult>
```

整个过程中 Agent UI 可以实时看到：

```text
[INFO] Start SCP02
[ACTION] Reset Card
[DATA] ATR: 3B...
[ACTION] SELECT ISD
[RESULT] SW=9000
[ACTION] INITIALIZE UPDATE
[DATA] Sequence Counter: 0012
[DATA] Card Challenge: ...
[STREAM] Deriving session keys...
[ACTION] EXTERNAL AUTHENTICATE
[RESULT] SW=9000
[INFO] Secure Channel Established
[ACTION] LOAD
[ACTION] INSTALL
[SUCCESS] Applet installed
```

---

# 36. AgentRuntimeContext 的关系

如果现有 SmartCard Agent 已经存在 `AgentRuntimeContext`，不建议再建立一套完全独立的 Runtime。

建议：

```text
AgentRuntimeContext
│
├── ReaderManager
├── CardSessionManager
├── SkillExecutor
├── EventStream
├── SecurityManager
└── Logger
```

Skill 获得的是：

```text
SkillContext
```

关系：

```text
AgentRuntimeContext
        ↓
SkillExecutor
        ↓
SkillContext
        ↓
Skill
```

这样可以限制 Skill 权限，同时保持 Runtime 的统一管理。

---

# 37. 核心 API 最终建议

## Skill

```java
public interface Skill<S> {

    S createSession(
        SkillContext context,
        SkillInput input
    );

    SkillResult start(
        SkillContext context,
        S session
    );

    SkillResult handleResult(
        SkillContext context,
        ActionResult result,
        S session
    );
}
```

## SkillResult

```java
public final class SkillResult {

    SkillStatus status;
    SkillAction nextAction;
    SkillError error;
}
```

## ActionResult

```java
public interface ActionResult {

    String getActionId();

    ActionType getActionType();

    boolean isSuccess();

    SkillError getError();
}
```

## SkillOutput

```java
public interface SkillOutputSink {

    void text(String text);
    void info(String text);
    void warn(String text);
    void error(String text);
    void data(Object data);
    void stream(String chunk);
}
```

## 最终结果

```java
public final class SkillExecutionResult<T> {

    SkillStatus status;
    T output;
    SkillError error;
}
```

---

# 38. 四种核心结果的最终定义

这一节作为开发规范，建议固定下来。

| 对象                      | 发生时机                | 方向                | 核心问题                       |
| ------------------------- | ----------------------- | ------------------- | ------------------------------ |
| `SkillResult`             | 每次 Skill 方法执行结束 | Skill → Runtime     | **下一步做什么？**             |
| `ActionResult`            | 每次 Action 执行完成    | Runtime → Skill     | **刚才发生了什么？**           |
| `SkillOutput`             | Skill 执行过程中        | Skill → EventStream | **需要让 Agent/UI 看到什么？** |
| `SkillExecutionResult<T>` | 整个 Skill 完成         | Runtime → Agent     | **最终业务结果是什么？**       |

可以用一句话记忆：

```text
ActionResult = Fact
SkillResult = Decision
SkillOutput = Observation / Presentation
SkillExecutionResult = Final Business Result
```

---

# 39. 当前版本明确不做的内容

为了控制架构复杂度，v2.3 暂不实现：

```text
❌ Skill DSL
❌ 动态修改 Skill 逻辑
❌ Runtime Logic Injection
❌ Execution Patch
❌ Extension Point
❌ Resume
❌ Checkpoint
❌ Rollback
❌ Skill Retry Framework
❌ 多卡并发调度
❌ Reader Pool
❌ 分布式 Session
❌ HSM 集成
```

这些内容不是永远不能做，而是**不属于当前核心 Runtime 的必要能力**。

---

# 40. 推荐开发顺序

## Phase 1：Core Runtime

实现：

```text
Skill
SkillSession
SkillResult
SkillAction
ActionResult
SkillExecutor
ActionExecutor
SkillOutput
SkillEvent
CardSession
Reader
```

## Phase 2：基础 Action

首先实现：

```text
RESET_CARD
APDU
```

然后根据实际 Skill 再添加：

```text
CONNECT
DISCONNECT
WAIT
DELAY
CUSTOM
```

## Phase 3：SCP02

实现：

```text
Scp02OpenSkill
Scp02Session
Scp02State
Scp02Result
```

## Phase 4：SCP02 + Load/Install

验证：

```text
RESET
SELECT
INITIALIZE UPDATE
SESSION KEY DERIVATION
EXTERNAL AUTHENTICATE
LOAD
INSTALL
```

## Phase 5：Agent UI EventStream

实现：

```text
Log
Stream
APDU Trace
Parsed Data
Progress
Warning
Error
```

## Phase 6：测试工具

提供：

```text
MockActionExecutor
RecordingEventStream
TestSkillContext
ReplayActionExecutor
```

---

# 41. 最终架构结论

SmartCard Agent Skill Runtime 最终采用：

```text
                         Agent
                           │
                           ▼
                    SkillExecutor
                           │
                           ▼
                         Skill
                           │
             ┌─────────────┼─────────────┐
             │             │             │
             ▼             ▼             ▼
       SkillSession    SkillResult    SkillOutput
             │             │             │
             │             ▼             ▼
             │        SkillAction    EventStream
             │             │             │
             │             ▼             ▼
             │      ActionExecutor    Agent UI
             │             │
             │             ▼
             └────── ActionResult
                           │
                           ▼
                         Skill
                           │
                           ▼
                  SkillExecutionResult
                           │
                           ▼
                         Agent
```

核心原则：

> **Skill 负责协议逻辑，Session 保存本次执行状态，SkillResult 驱动执行流程，Action 表示 Runtime 要执行的操作，ActionResult 表示实际执行结果，SkillOutput 负责过程信息输出，SkillExecutionResult 负责最终业务结果，Executor 负责整个运行生命周期。**

对于当前桌面 SmartCard Agent 场景，这套设计在保持灵活性的同时，避免引入暂时没有必要的 Resume、Retry、并发调度、动态代码注入和 DSL 等复杂机制。
