# SmartCard Agent Skills 完整架构设计方案

**版本：v2.2**  
**适用范围：SmartCard Agent / SmartCard Skills / APDU Script / SCP02 / SCP80 / Secure Channel / Profile Download / Card Operations**

---

## 1. 文档定位

本文档定义 SmartCard Agent 的 Skills Runtime 架构。

本版本在 v2.1 的基础上做两项关键调整：

1. **SkillAction 正式取代“Skill 只能返回 APDU Command”的设计。** Skill 可以要求 Runtime 执行 APDU、Reset、Connect、Disconnect、Wait、Delay、Custom 等不同动作。
2. **Skill 是协议逻辑的拥有者。** Skill 作者应能够完整控制 APDU、Action 参数、响应解析、状态转换、计算过程和业务输出；Runtime 负责执行环境、生命周期、事件、日志、安全和设备访问，不为了“简化开发”而隐藏 SmartCard 领域信息。

本版本**不引入 DSL 作为 Skill 的必需开发方式**。复杂 Skill 以 Java / Python 等宿主语言实现即可。

---

# 2. 背景与问题

SmartCard 中存在大量无法通过单条 APDU 完成的操作：

- SCP02 Secure Channel 建立
- SCP80 Channel 建立
- PIN Verify / PIN Unblock
- GlobalPlatform Key Management
- Secure Messaging
- Profile Download
- OTA
- Application 初始化
- Card Personalization
- 文件读写及条件式流程

典型流程如下：

```text
操作步骤
   ↓
产生 Action
   ↓
Runtime 执行 Action
   ↓
得到 ActionResult
   ↓
Skill 解析结果
   ↓
更新 Session
   ↓
决定下一步
   ↓
产生下一个 Action
```

尤其是 SCP02：

```text
RESET
  ↓
INITIALIZE UPDATE
  ↓
解析 Card Challenge / Sequence Counter
  ↓
派生 Session Keys
  ↓
计算 Host Cryptogram
  ↓
EXTERNAL AUTHENTICATE
  ↓
验证结果
  ↓
建立 Secure Channel
```

因此，一个 Skill 本质上是一个**有状态的协议执行过程**，而不是简单的：

```text
Input → APDU → Response
```

---

# 3. 设计目标

## 3.1 类型安全

每个 Skill 使用自己的 Session 类型：

```java
Skill<Scp02Session>
Skill<Scp80Session>
Skill<ProfileDownloadSession>
```

避免：

```java
Map<String, Object>
```

导致的类型转换和字段命名问题。

## 3.2 Skill 与 Session 分离

```text
Skill        = 协议定义 / 行为
SkillSession = 一次执行的动态状态
```

一个 Skill 实例不得持有某一次执行专属的 Session。

## 3.3 Skill 拥有完整协议控制权

Skill 可以决定：

- 发什么 APDU
- APDU 的 CLA / INS / P1 / P2 / Data / Le
- 当前 Action 的描述信息
- 如何解析 Response
- 哪些字段保存到 Session
- 如何进行密码学计算
- 下一步执行什么 Action
- 什么时候成功 / 失败 / 暂停 / 等待

Runtime 不应该猜测或替 Skill 决定上述协议逻辑。

## 3.4 支持非 APDU 操作

Skill Action 不局限于 APDU。

至少应支持：

```text
APDU
RESET_CARD
CONNECT_READER
DISCONNECT_READER
WAIT
DELAY
CUSTOM
```

以后可扩展：

```text
POWER_ON
POWER_OFF
CARD_PRESENT
WAIT_CARD_INSERT
WAIT_CARD_REMOVE
OPEN_LOGICAL_CHANNEL
CLOSE_LOGICAL_CHANNEL
```

## 3.5 支持丰富输出

Skill 过程和最终结果都不仅仅是 APDU：

```text
APDU 描述
Response
解析数据
状态变化
日志
进度
Warning
Error
最终业务结果
```

## 3.6 支持实时日志和流式输出

Skill 执行过程中的日志可以：

- 普通字符串输出
- 流式输出
- 结构化日志
- 进度事件
- Action 生命周期事件
- Response 解析事件

并实时传递到 Agent UI。

## 3.7 Reader 与 Skill 解耦

Skill 不直接依赖 PCSC、USB、Serial 等 Reader 实现。

```text
Skill
 ↓
Action
 ↓
Runtime / ActionExecutor
 ↓
Reader
```

## 3.8 支持暂停、恢复、重试和取消

Runtime 应支持：

```text
RUNNING
WAITING
PAUSED
SUCCESS
FAILED
CANCELLED
```

## 3.9 安全状态隔离

SCP02 静态密钥和 Session Key 不能进入普通日志或无保护持久化。

---

# 4. 核心设计原则

## 4.1 Runtime 管“怎么执行”，Skill 管“执行什么”

这是整个架构最重要的原则。

```text
Skill
  └── 决定协议逻辑

Runtime
  └── 提供执行环境
```

例如 Skill 可以明确要求：

```java
ResetCardAction

ApduAction

WaitAction
```

Runtime 不需要知道为什么 SCP02 要 Reset，也不需要理解 Host Cryptogram 的算法。

## 4.2 不为了“API 简单”而损失领域信息

SmartCard Skill 作者本身就是协议开发者。

以下信息应该保留：

```text
APDU
APDU description
Step ID
Expected response
Parsed response
State
Metadata
Security level
Key version
Sequence Counter
Protocol-specific data
```

可以隐藏的是 Runtime 实现细节：

```text
PCSC
USB transport
EventBus 实现
线程模型
SessionStore 实现
WebSocket 实现
日志缓冲实现
```

## 4.3 Action 是统一执行载体

```text
Skill → SkillAction → Runtime
```

Action 的作用是描述：

> Skill 要求 Runtime 现在执行什么。

## 4.4 ActionResult 描述执行结果

```text
Action → ActionResult → Skill
```

不同 Action 可以有不同 Result 类型：

```text
ApduAction      → ApduActionResult
ResetCardAction → ResetCardResult
WaitAction      → WaitResult
CustomAction    → CustomActionResult
```

## 4.5 Event 与 Result 分离

```text
ActionResult = 这次执行最终得到了什么

SkillEvent   = 执行过程中发生了什么
```

例如：

```text
ActionResult
  → ATR

SkillEvent
  → "Card reset completed"
  → progress=20%
```

## 4.6 SkillSession 与 CardSession 分离

```text
SkillSession
= 一次 Skill 执行过程中的状态

CardSession
= 当前 Card 生命周期内的运行上下文
```

例如 SCP02 成功建立后，Secure Channel 可能继续服务于后续 Profile Download，因此 Secure Channel 上下文不能只存在于一次 Skill 调用的临时对象里。

---

# 5. 总体架构

```text
                         ┌──────────────────┐
                         │       Agent      │
                         │ UI / LLM / Tool  │
                         └────────┬─────────┘
                                  │
                                  │ skillId + input
                                  ▼
                         ┌──────────────────┐
                         │   SkillRegistry  │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │   SkillFactory   │
                         └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │      Skill       │
                         │ Protocol Logic   │
                         └────────┬─────────┘
                                  │
                       SkillResult / Action
                                  │
                                  ▼
                         ┌──────────────────┐
                         │  SkillExecutor   │
                         └────────┬─────────┘
                                  │
                        ┌─────────┼──────────┐
                        │         │          │
                        ▼         ▼          ▼
                 SkillSession EventStream CardSession
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ ActionExecutor   │
                         └────────┬─────────┘
                                  │
               ┌──────────────────┼───────────────────┐
               │                  │                   │
               ▼                  ▼                   ▼
            APDUAction        ResetAction         OtherAction
               │                  │                   │
               └──────────────────┼───────────────────┘
                                  ▼
                               Reader
                                  │
                                  ▼
                            ActionResult
                                  │
                                  └────────────→ Skill
```

---

# 6. 核心对象职责

| 对象            | 职责                                      |
| --------------- | ----------------------------------------- |
| Agent           | 业务编排、调用 Skill、展示结果            |
| SkillRegistry   | 根据 skillId 查找 Skill / Factory         |
| SkillFactory    | 根据运行参数创建 Skill                    |
| Skill           | 协议逻辑、响应解析、状态转换、Action 生成 |
| SkillSession    | 一次执行的动态状态                        |
| SkillState      | Skill 当前状态机状态                      |
| SkillResult     | Skill 当前处理结果及下一步动作            |
| SkillAction     | 要求 Runtime 执行的动作                   |
| ActionExecutor  | 执行 Action                               |
| ActionResult    | Action 的执行结果                         |
| SkillOutput     | Skill 对外输出的结构化结果                |
| SkillEvent      | 日志、进度、Trace、解析等事件             |
| EventStream     | 向 Agent/UI 实时传递事件                  |
| CardSession     | 当前 Card / Secure Channel 的上下文       |
| Reader          | PCSC / USB / Serial 等硬件接口            |
| SessionStore    | Skill Session 持久化                      |
| SecurityContext | 密钥等敏感运行状态                        |

---

# 7. Skill 接口

推荐接口：

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
     * 处理 Runtime 返回的 ActionResult。
     */
    SkillResult handleResult(
        SkillContext context,
        ActionResult result,
        S session
    );
}
```

这里明确不再使用：

```java
nextCommand(Response previousResponse, S session)
```

因为 Skill 的下一步可能不是 APDU，而是任意 Action。

同时也不推荐：

```java
handleResponse(Response response, ...)
```

因为 RESET 等动作得到的结果不是普通 APDU Response。

---

# 8. SkillSession

## 8.1 基础接口

```java
public interface SkillSession {

    String getSessionId();

    String getSkillId();

    SessionStatus getStatus();

    Instant getCreatedAt();

    Instant getUpdatedAt();
}
```

## 8.2 类型化 Session

```java
public final class Scp02Session implements SkillSession {

    private final String sessionId;

    private Scp02State state;

    private byte[] hostChallenge;
    private byte[] cardChallenge;
    private byte[] sequenceCounter;

    private int keyVersion;
    private int keyIdentifier;

    private SecurityContext securityContext;

    private byte[] cardCryptogram;
    private byte[] hostCryptogram;

    // getters / setters
}
```

Skill 作者可以按照具体协议定义自己的 Session。

```text
Scp02Session
Scp80Session
PinSession
ProfileDownloadSession
```

## 8.3 Skill 不持有 Session

错误：

```java
class Scp02OpenSkill {
    private Scp02Session session;
}
```

推荐：

```text
Skill Definition
      ↓
Executor 创建 Session
      ↓
每次 Execution 一个独立 Session
```

这样支持：

```text
Skill Definition 复用
Concurrent Execution
Session 恢复
Session 持久化
```

---

# 9. SkillState

推荐为复杂 Skill 使用显式状态机。

例如：

```java
public enum Scp02State {

    START,
    WAIT_RESET,
    WAIT_SELECT,
    WAIT_INITIALIZE_UPDATE,
    WAIT_EXTERNAL_AUTHENTICATE,
    ESTABLISHED,
    FAILED
}
```

避免：

```java
int step = 1;
```

也不要通过 Response 内容猜当前步骤。

正确方式：

```text
Current State
      +
ActionResult
      ↓
下一状态 / 下一 Action
```

---

# 10. SkillAction

## 10.1 Action 接口

```java
public interface SkillAction {

    String getActionId();

    ActionType getType();

    ActionMetadata getMetadata();

    Duration getTimeout();
}
```

## 10.2 ActionType

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

## 10.3 ActionMetadata

建议至少包含：

```java
public final class ActionMetadata {

    private String name;
    private String description;
    private String stepId;
    private Map<String, Object> attributes;
}
```

例如 APDU：

```text
id: scp02.initialize-update
name: Initialize Update
description: 获取卡片 Challenge、Sequence Counter 等初始化数据
stepId: initialize-update
```

这些描述信息应该保留，因为它们属于 Skill 作者提供的领域信息，可以直接被 Agent UI 使用。

---

# 11. ApduAction

```java
public final class ApduAction implements SkillAction {

    private final String actionId;
    private final byte[] apdu;
    private final ActionMetadata metadata;
    private final boolean sensitive;

    // getters
}
```

示例：

```java
return SkillResult.continueWith(
    ApduAction.builder()
        .actionId("scp02.initialize-update")
        .apdu(apdu)
        .metadata(
            ActionMetadata.builder()
                .name("Initialize Update")
                .description(
                    "获取卡片 Challenge、Sequence Counter 和 Cryptogram"
                )
                .stepId("initialize-update")
                .build()
        )
        .sensitive(true)
        .build()
);
```

这里没有隐藏 APDU。

Skill 作者可以完全控制 APDU 内容与描述。

---

# 12. ResetCardAction

RESET 不属于 APDU，因此单独建模。

```java
public final class ResetCardAction implements SkillAction {

    private final String actionId;
    private final ResetMode mode;
    private final ActionMetadata metadata;
}
```

例如：

```java
return SkillResult.continueWith(
    ResetCardAction.builder()
        .actionId("scp02.reset")
        .mode(ResetMode.COLD)
        .metadata(
            ActionMetadata.builder()
                .name("Reset Card")
                .description("Reset card before SCP02 initialization")
                .stepId("reset")
                .build()
        )
        .build()
);
```

---

# 13. ActionResult

## 13.1 基础接口

```java
public interface ActionResult {

    String getActionId();

    ActionType getActionType();

    boolean isSuccess();

    Duration getDuration();
}
```

## 13.2 APDU Result

```java
public final class ApduActionResult implements ActionResult {

    private final Response response;
}
```

## 13.3 Reset Result

```java
public final class ResetCardResult implements ActionResult {

    private final byte[] atr;

    private final ResetMode mode;
}
```

这样：

```text
ApduAction
   ↓
ApduActionResult
   ↓
Response
```

而：

```text
ResetCardAction
   ↓
ResetCardResult
   ↓
ATR
```

两者不强行塞进同一种 Response。

---

# 14. Response

APDU Response 只表示卡片对 APDU 的响应。

```java
public final class Response {

    private final byte[] data;
    private final int sw;
    private final long elapsedMs;

    public byte[] getData() {
        return data.clone();
    }

    public int getSw() {
        return sw;
    }

    public long getElapsedMs() {
        return elapsedMs;
    }
}
```

Response 不负责：

```text
状态机
业务解析
Skill 输出
```

---

# 15. SkillResult

SkillResult 表达：

> Skill 处理完当前输入后，希望 Runtime 接下来做什么。

```java
public enum SkillStatus {

    CONTINUE,
    SUCCESS,
    FAILED,
    WAITING,
    PAUSED
}
```

```java
public final class SkillResult {

    private final SkillStatus status;
    private final SkillAction nextAction;
    private final SkillOutput output;
    private final SkillError error;
}
```

静态工厂：

```java
SkillResult.continueWith(action)
SkillResult.success(output)
SkillResult.failed(error)
SkillResult.waiting(output)
SkillResult.paused(output)
```

不再使用：

```java
nextCommand() == null
```

表示结束。

---

# 16. SkillOutput

SkillOutput 用于承载 Skill 对外输出，而不是执行过程日志。

例如 SCP02：

```java
public final class Scp02Result implements SkillOutput {

    private final boolean established;
    private final int keyVersion;
    private final int securityLevel;
    private final String channelId;
}
```

示例：

```text
SkillOutput
{
    established: true,
    keyVersion: 0x01,
    securityLevel: MAC,
    channelId: "scp02-xxx"
}
```

敏感 Key 不作为普通 Output 暴露。

---

# 17. SkillEvent 与 EventStream

## 17.1 为什么要单独设计 Event

Skill 运行过程中会产生大量不是最终 Result 的信息，例如：

```text
Starting SCP02
Reset card
Sending Initialize Update
Parsing response
Sequence Counter = 0012
Deriving session keys
External Authenticate sent
SCP02 established
```

这些应该实时给 Agent UI。

## 17.2 SkillEvent

```java
public interface SkillEvent {

    String getExecutionId();

    String getSkillId();

    String getSessionId();

    Instant getTimestamp();

    SkillEventType getType();
}
```

## 17.3 Event 类型

```java
public enum SkillEventType {

    LOG,
    OUTPUT,
    PROGRESS,
    STATE_CHANGED,
    ACTION_STARTED,
    ACTION_COMPLETED,
    ACTION_FAILED,
    APDU_SENT,
    APDU_RECEIVED,
    PARSE_RESULT,
    WARNING,
    ERROR
}
```

## 17.4 日志支持字符串和流式

普通字符串：

```java
ctx.log("Sending Initialize Update");
```

流式：

```java
ctx.logStream("Deriving session keys...");
ctx.logStream("step 1 completed");
ctx.logStream("step 2 completed");
ctx.logStreamEnd();
```

更推荐 Runtime 内部统一转换为：

```text
SkillLogEvent
```

对于 UI 来说，只是一条实时事件流。

---

# 18. SkillLogger

提供给 Skill 作者的日志能力：

```java
public interface SkillLogger {

    void debug(String message);

    void info(String message);

    void warn(String message);

    void error(String message);

    void emit(String message);

    SkillLogStream stream();
}
```

`SkillLogger` 不直接打印到控制台。

它应该进入：

```text
SkillLogger
   ↓
EventStream
   ↓
Agent Runtime
   ↓
UI / Console / Trace / File
```

这样 Agent UI 可以实时看到 Skill 日志。

---

# 19. SkillContext

SkillContext 是 Skill 能够访问的运行环境。

建议：

```java
public interface SkillContext {

    CardSession cardSession();

    CryptoService crypto();

    SkillLogger logger();

    EventEmitter events();

    Clock clock();
}
```

注意：

**如果采用“Skill 只返回 Action、Runtime 执行 Action”的严格模型，SkillContext 不必直接暴露 Reader。**

Skill 通过返回 Action 表达意图：

```text
Skill → ResetCardAction
Skill → ApduAction
```

Runtime 再负责：

```text
Action → Reader → ActionResult
```

这样 Reader 不会进入业务协议代码。

---

# 20. ActionExecutor

```java
public interface ActionExecutor {

    ActionResult execute(
        SkillAction action,
        RuntimeContext context
    );
}
```

实现：

```text
ActionExecutor
├── ApduActionExecutor
├── ResetCardActionExecutor
├── ConnectActionExecutor
├── WaitActionExecutor
└── CustomActionExecutor
```

例如：

```text
ResetCardAction
      ↓
ResetCardActionExecutor
      ↓
Reader.reset()
      ↓
ResetCardResult
```

---

# 21. SkillExecutor

SkillExecutor 驱动完整生命周期。

```java
public final class SkillExecutor {

    public <S> SkillExecutionResult execute(
        Skill<S> skill,
        SkillContext context,
        SkillInput input
    ) {

        S session =
            skill.createSession(context, input);

        SkillResult result =
            skill.start(context, session);

        while (result.getStatus() == SkillStatus.CONTINUE) {

            SkillAction action =
                result.getNextAction();

            publishActionStarted(action);

            ActionResult actionResult =
                actionExecutor.execute(action, context);

            publishActionCompleted(
                action,
                actionResult
            );

            result =
                skill.handleResult(
                    context,
                    actionResult,
                    session
                );
        }

        return new SkillExecutionResult(
            session,
            result
        );
    }
}
```

Executor 负责：

- 生命周期
- Action 调度
- Reader 访问
- Event
- 日志
- Timeout
- Retry
- Cancel
- Session 状态保存
- 异常统一转换

Skill 负责：

- 协议逻辑
- Action 定义
- Response / ActionResult 解析
- Session 更新
- 状态转换
- 业务输出

---

# 22. SCP02 插入 RESET 的完整实现

这是本架构最典型的案例。

## 22.1 状态机

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

## 22.2 Start

```java
@Override
public SkillResult start(
    SkillContext ctx,
    Scp02Session session
) {

    session.setState(Scp02State.WAIT_RESET);

    ctx.logger().info("Starting SCP02");

    return SkillResult.continueWith(
        ResetCardAction.builder()
            .actionId("scp02.reset")
            .mode(ResetMode.COLD)
            .metadata(
                ActionMetadata.builder()
                    .name("Reset Card")
                    .description(
                        "Reset card before SCP02 initialization"
                    )
                    .stepId("reset")
                    .build()
            )
            .build()
    );
}
```

## 22.3 处理 ResetResult

```java
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

            ctx.logger().info(
                "Card reset completed"
            );

            session.setState(
                Scp02State.WAIT_INITIALIZE_UPDATE
            );

            return SkillResult.continueWith(
                buildInitializeUpdateAction(session)
            );

        case WAIT_INITIALIZE_UPDATE:

            ApduActionResult initializeUpdate =
                result.require(
                    ApduActionResult.class
                );

            parseInitializeUpdate(
                initializeUpdate.getResponse(),
                session
            );

            deriveSessionKeys(session);

            session.setState(
                Scp02State.WAIT_EXTERNAL_AUTHENTICATE
            );

            return SkillResult.continueWith(
                buildExternalAuthenticateAction(
                    session
                )
            );

        case WAIT_EXTERNAL_AUTHENTICATE:

            ApduActionResult authenticate =
                result.require(
                    ApduActionResult.class
                );

            verifyExternalAuthenticate(
                authenticate.getResponse(),
                session
            );

            session.setState(
                Scp02State.ESTABLISHED
            );

            return SkillResult.success(
                buildScp02Result(session)
            );

        default:
            return SkillResult.failed(
                new IllegalStateException(
                    "Unexpected SCP02 state"
                )
            );
    }
}
```

## 22.4 最终流程

```text
START
  │
  ▼
ResetCardAction
  │
  ▼
ResetCardResult
  │
  ├── ATR
  └── CardSession 更新
  │
  ▼
ApduAction: INITIALIZE UPDATE
  │
  ▼
ApduActionResult
  │
  ├── Card Challenge
  ├── Sequence Counter
  ├── Key Version
  └── Card Cryptogram
  │
  ▼
Skill 派生 Session Keys
  │
  ▼
ApduAction: EXTERNAL AUTHENTICATE
  │
  ▼
ApduActionResult
  │
  ▼
验证
  │
  ▼
SkillOutput: SCP02 Established
```

这说明 RESET 不需要特殊修改 SkillExecutor 的模型。

它只是：

```text
另一种 SkillAction
+
另一种 ActionResult
```

---

# 23. RESET 对 CardSession 的影响

Reset 有一个特殊副作用：

```text
Card Reset
 ↓
当前 Card Runtime 状态发生变化
```

尤其是：

```text
Secure Channel
Logical Channel
Selected Application
Session-specific Card State
```

通常需要清理或重新初始化。

因此建议：

```java
public final class CardSession {

    private byte[] atr;
    private Protocol protocol;
    private String readerId;

    private SecureChannelContext secureChannel;

    private String selectedApplication;

    public void onReset(byte[] atr) {
        this.atr = atr.clone();
        this.secureChannel = null;
        this.selectedApplication = null;
    }
}
```

Runtime 在执行 ResetCardAction 成功后调用：

```text
CardSession.onReset(ATR)
```

而不是让 Skill 自己操作 Reader 内部状态。

---

# 24. CardSession 与 SkillSession

## 24.1 SkillSession

生命周期：

```text
CREATED
 ↓
RUNNING
 ↓
WAITING / PAUSED
 ↓
RUNNING
 ↓
SUCCESS / FAILED / CANCELLED
```

例如：

```text
Scp02Session
```

记录当前 SCP02 执行过程。

## 24.2 CardSession

生命周期通常与当前物理 Card 的连接和会话相关：

```text
DISCONNECTED
 ↓
CONNECTED
 ↓
RESET
 ↓
READY
 ↓
SECURE_CHANNEL_ESTABLISHED
```

Reset 后：

```text
SECURE_CHANNEL_ESTABLISHED
        ↓
      RESET
        ↓
READY
```

Secure Channel 通常需要重新建立。

---

# 25. Secure Channel 的生命周期

建议最终形成：

```text
CardSession
   │
   ├── ATR
   ├── Selected Application
   │
   └── SecureChannelContext
           │
           ├── protocol = SCP02
           ├── securityLevel
           ├── keyVersion
           ├── session keys
           └── channel state
```

SCP02 Skill 成功以后：

```text
Scp02OpenSkill
      ↓
Scp02Result
      ↓
Runtime
      ↓
CardSession.secureChannel
```

这样后续 Skill 可以复用 Secure Channel。

---

# 26. 日志 / Event 到 Agent UI

推荐使用单向 Event Stream：

```text
Skill
 ↓
SkillLogger / EventEmitter
 ↓
SkillExecutor
 ↓
EventStream
 ↓
Agent Runtime
 ↓
UI / WebSocket / SSE
```

例如 Agent UI 可以实时显示：

```text
[12:01:01] INFO  Starting SCP02
[12:01:01] ACTION RESET_CARD
[12:01:01] RESULT ATR=3B9F...
[12:01:01] ACTION INITIALIZE_UPDATE
[12:01:02] RESULT SW=9000
[12:01:02] PARSE SequenceCounter=0012
[12:01:02] PARSE CardChallenge=********
[12:01:02] INFO  Deriving session keys
[12:01:02] ACTION EXTERNAL_AUTHENTICATE
[12:01:03] RESULT SW=9000
[12:01:03] SUCCESS SCP02 channel established
```

日志传输应与 SkillResult 解耦。

---

# 27. 字符串日志与流式日志

推荐底层统一为 Event：

```java
public final class LogEvent implements SkillEvent {

    private final LogLevel level;
    private final String message;
    private final boolean streaming;
    private final String streamId;
    private final boolean streamEnd;
}
```

普通：

```text
streaming=false
```

流式：

```text
streaming=true
streamId=xxx
streamEnd=false
```

结束：

```text
streamEnd=true
```

这样 UI 可以逐块显示文本，而不需要等待整个 Skill 完成。

---

# 28. APDU 描述与解析信息

APDU Action 不应该只有：

```text
byte[] apdu
```

建议支持：

```java
ApduAction
├── actionId
├── stepId
├── apdu
├── name
├── description
├── sensitive
├── expectedResponse
├── timeout
└── metadata
```

APDU Result 可以支持：

```java
ApduActionResult
├── response
├── parsedData
├── interpretation
└── metadata
```

例如：

```json
{
  "actionId": "scp02.initialize-update",
  "type": "APDU",
  "description": "获取 SCP02 初始化数据",
  "apdu": "8050000008...",
  "result": {
    "sw": "9000",
    "parsedData": {
      "keyVersion": "01",
      "sequenceCounter": "0012"
    }
  }
}
```

这样 Agent UI 可以同时展示：

```text
原始 APDU
↓
状态字
↓
协议解析
```

但敏感字段必须脱敏。

---

# 29. 安全设计

## 29.1 敏感数据分类

SCP02 可能包含：

```text
Static ENC Key
Static MAC Key
Static KEK Key
Session ENC Key
Session MAC Key
Session KEK Key
```

这些数据不能进入普通日志。

## 29.2 SecurityContext

推荐：

```java
public interface SecurityContext {

    SecureKey getEncKey();

    SecureKey getMacKey();

    SecureKey getKekKey();

    SecureKey getSessionEncKey();

    SecureKey getSessionMacKey();

    SecureKey getSessionKekKey();
}
```

SecurityContext 与普通 Session State 分开。

## 29.3 日志白名单

允许：

```text
keyVersion
securityLevel
algorithm
keyIdentifier
```

禁止：

```text
完整 Key
Session Key
Cryptographic secret
```

## 29.4 Action 敏感标记

APDU Action 可以：

```java
sensitive=true
```

Runtime 根据该标志决定：

```text
完整数据只存在内存
日志中脱敏
Trace 中脱敏
UI 中脱敏
```

---

# 30. Retry 设计

Retry 分为三层。

## 30.1 Transport Retry

Reader / PCSC / USB 通讯错误。

```text
Reader error
 ↓
Transport retry
```

## 30.2 Action Retry

例如某个 Action 允许重新执行。

```text
APDU Action
 ↓
特定 SW
 ↓
重新发送
```

## 30.3 Skill Retry

协议状态发生失败，需要回到某个状态重新执行。

例如 SCP02：

```text
EXTERNAL AUTHENTICATE
 ↓
失败
 ↓
Skill 判断是否重新 Reset + Initialize Update
```

不能无限自动重试。

RetryPolicy 可作为 Action Metadata 或 Skill Policy。

---

# 31. Timeout / Cancel

每个 Action 可配置：

```java
Duration timeout;
```

Executor 负责：

```text
Action timeout
 ↓
ActionFailed
 ↓
Skill.handleResult()
```

取消：

```text
Agent
 ↓
cancel(executionId)
 ↓
SkillExecutor
 ↓
停止当前 Action
 ↓
Session = CANCELLED
```

Skill 不应自行管理 Reader 线程。

---

# 32. Suspend / Resume

Skill 支持等待外部输入：

```text
Skill
 ↓
SkillStatus.WAITING
 ↓
Agent / UI 提供输入
 ↓
resume()
 ↓
Skill.handleExternalInput()
```

例如 Profile Download：

```text
准备下载
 ↓
WAITING_USER_CONFIRMATION
 ↓
用户确认
 ↓
继续
```

建议 Session 带唯一：

```text
sessionId
executionId
```

---

# 33. Session 持久化

第一阶段：

```text
MemorySessionStore
```

以后可以：

```text
SQLiteSessionStore
RedisSessionStore
```

接口：

```java
public interface SkillSessionStore {

    void save(SkillSession session);

    SkillSessionSnapshot load(String sessionId);

    void delete(String sessionId);
}
```

注意：

**普通 Session Snapshot 不应直接包含明文密钥。**

SecurityContext 应使用安全存储、受保护句柄或仅在内存保存。

---

# 34. 异常模型

建议统一定义：

```text
SkillException
├── SkillValidationException
├── ActionExecutionException
├── ApduExecutionException
├── ProtocolException
├── SecurityException
├── TimeoutException
├── SessionException
└── SkillCancelledException
```

Executor 可统一转换：

```java
SkillResult.failed(error)
```

Agent 不需要理解底层 PCSC Exception 的全部细节。

---

# 35. Skill Registry / Factory

Agent 如果根据名称调用 Skill：

```java
public interface SkillRegistry {

    SkillFactory<?> getFactory(String skillId);
}
```

例如：

```text
scp02.open
scp02.close
scp80.open
pin.verify
pin.change
profile.download
profile.enable
```

Factory：

```java
public interface SkillFactory<S> {

    Skill<S> create(SkillInput input);
}
```

执行：

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

Agent 不需要知道具体 Java 构造函数。

---

# 36. Agent 与 RuntimeContext

如果现有 SmartCard Agent 已经拥有 RuntimeContext，不建议重新建立完全平行的一套上下文。

推荐：

```text
AgentRuntimeContext
│
├── ReaderManager
├── CardSessionManager
├── SkillRuntime
├── EventBus
├── Logger
├── SecurityManager
└── Knowledge / RAG
```

Skill 得到受控的：

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

这样 Skill 不会获得过大的 Agent 权限。

---

# 37. 并发模型

基本原则：

```text
一个 Skill Execution
        ↓
一个独立 SkillSession
```

禁止：

```text
Thread A ─┐
          ├── Shared Scp02Session
Thread B ─┘
```

应该：

```text
Thread A → Session A
Thread B → Session B
```

Skill Definition 可以共享，只要不保存执行状态。

对于同一个物理 Reader / Card，要根据 Reader 本身是否允许并发传输进行串行化。

推荐：

```text
ReaderSession / CardSession
        ↓
per-reader operation lock
```

即使 Skill Session 独立，也不代表同一个卡片可以被多个线程同时发送 APDU。

---

# 38. 可测试性

## 38.1 Skill 单元测试

Skill 不依赖真实 Reader。

测试：

```text
ResetCardResult
        ↓
Scp02Skill
        ↓
InitializeUpdate Action
```

模拟：

```text
Initialize Update Result
        ↓
Scp02Skill
        ↓
External Authenticate Action
```

验证：

- Action 是否正确
- Action 描述是否正确
- Session 是否正确更新
- State 是否正确转换
- APDU 是否正确
- Cryptogram 是否正确
- 错误 SW 是否正确处理

## 38.2 Executor 测试

使用 Mock ActionExecutor：

```text
ResetCardAction → Mock ResetCardResult
ApduAction      → Mock ApduActionResult
```

## 38.3 Event 测试

验证：

```text
LOG
ACTION_STARTED
ACTION_COMPLETED
PARSE_RESULT
SUCCESS
```

事件顺序正确。

## 38.4 Integration Test

使用真实：

```text
Reader
PCSC
Card
Skill
```

## 38.5 Regression Test

保存：

```text
Action
Result
ParsedData
State
```

生成可复现的协议 Trace。

密钥必须脱敏。

---

# 39. Java Package 建议

```text
smartcard-agent/
│
├── runtime/
│   ├── SkillExecutor.java
│   ├── ActionExecutor.java
│   ├── RuntimeContext.java
│   └── SkillRuntime.java
│
├── skill/
│   ├── Skill.java
│   ├── SkillInput.java
│   ├── SkillResult.java
│   ├── SkillStatus.java
│   ├── SkillContext.java
│   ├── SkillRegistry.java
│   └── SkillFactory.java
│
├── session/
│   ├── SkillSession.java
│   ├── SkillSessionStore.java
│   ├── SessionStatus.java
│   ├── CardSession.java
│   └── CardSessionManager.java
│
├── action/
│   ├── SkillAction.java
│   ├── ActionType.java
│   ├── ActionMetadata.java
│   ├── ActionResult.java
│   ├── ApduAction.java
│   ├── ApduActionResult.java
│   ├── ResetCardAction.java
│   ├── ResetCardResult.java
│   └── CustomAction.java
│
├── apdu/
│   ├── Command.java
│   ├── Response.java
│   ├── ApduChannel.java
│   └── ApduParser.java
│
├── event/
│   ├── SkillEvent.java
│   ├── SkillEventType.java
│   ├── EventStream.java
│   ├── EventEmitter.java
│   └── LogEvent.java
│
├── reader/
│   ├── Reader.java
│   ├── PcscReader.java
│   ├── UsbReader.java
│   └── MockReader.java
│
├── security/
│   ├── CryptoService.java
│   ├── SecurityContext.java
│   └── SecureKeyStore.java
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

# 40. Skill 开发者需要理解什么

本架构不追求隐藏 SmartCard 协议细节，而是让开发者只需要理解**与协议实现直接相关的 Runtime API**。

核心概念：

```text
Skill
Session
State
Action
ActionResult
SkillOutput
SkillLogger
SkillContext
```

典型开发流程：

```text
1. 定义 Session
2. 定义 State
3. 实现 Skill
4. 产生 Action
5. 处理 ActionResult
6. 输出 SkillOutput
7. 使用 logger / event 输出过程信息
```

不要求 Skill 作者学习新的 DSL。

---

# 41. Code Skill 是默认开发方式

对于复杂 SmartCard Skill：

```text
SCP02
SCP80
Secure Messaging
GlobalPlatform
Profile Download
```

推荐直接使用：

```text
Java
或
Python
```

原因：

- 类型安全
- IDE 支持
- 单元测试成熟
- 密码学逻辑容易表达
- 条件分支自然
- 调试方便
- 复杂协议没有表达限制

Skill 开发者能够完整表达协议，而不需要再学习一套新的 Skill DSL。

---

# 42. 为什么不把 DSL 作为当前方案的一部分

本版本明确：

> **不设计、不要求、不依赖 DSL。**

原因：

1. SmartCard Skill 本身已经具有较高的领域复杂度。
2. SCP02 等协议需要精确控制 APDU、解析、状态和密码学计算。
3. 新 DSL 会增加 Skill 作者的学习和调试成本。
4. Java / Python 本身已经足够表达 Skill。
5. DSL 即使未来出现，也应该属于可选的上层工具，而不是 Runtime 核心依赖。

未来如果确实存在大量简单脚本，再另行设计，不应影响当前核心 Runtime API。

---

# 43. 与原 ContextMap 方案对比

| 维度                | ContextMap     | v2.2 类型化 Session + Action |
| ------------------- | -------------- | ---------------------------- |
| 状态类型安全        | 低             | 高                           |
| IDE 支持            | 弱             | 强                           |
| Skill 可读性        | 中             | 高                           |
| 非 APDU 操作        | 难表达         | 原生支持                     |
| APDU 描述           | 需要额外约定   | Action Metadata              |
| Response 解析       | 混在流程里     | Skill 明确控制               |
| 日志流式输出        | 不明确         | EventStream                  |
| Agent UI 展示       | 一般           | 强                           |
| 状态机              | 一般           | 强                           |
| Session 并发隔离    | 容易出错       | 明确                         |
| Card 生命周期       | 容易混在 Skill | CardSession 独立             |
| Secure Channel 复用 | 较难           | 清晰                         |
| Retry / Timeout     | 分散           | Runtime 统一                 |
| 取消 / 暂停 / 恢复  | 较弱           | 原生预留                     |
| DSL 依赖            | 可扩展         | 无依赖                       |

---

# 44. 核心 API 总结

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
    SkillOutput output;
    SkillError error;
}
```

## SkillAction

```java
public interface SkillAction {

    String getActionId();

    ActionType getType();

    ActionMetadata getMetadata();
}
```

## ActionResult

```java
public interface ActionResult {

    String getActionId();

    ActionType getActionType();

    boolean isSuccess();
}
```

## SkillEvent

```java
public interface SkillEvent {

    String getExecutionId();

    String getSkillId();

    String getSessionId();

    SkillEventType getType();
}
```

---

# 45. 最终执行模型

完整模型：

```text
                          Agent
                            │
                            ▼
                     SkillRegistry
                            │
                            ▼
                      SkillFactory
                            │
                            ▼
                          Skill
                            │
                     createSession()
                            │
                            ▼
                     SkillSession
                            │
                          start()
                            │
                            ▼
                       SkillResult
                            │
                            ▼
                       SkillAction
                            │
                            ▼
                     SkillExecutor
                            │
                            ▼
                    ActionExecutor
                            │
           ┌────────────────┼─────────────────┐
           ▼                ▼                 ▼
         APDU             RESET             OTHER
           │                │                 │
           └────────────────┼─────────────────┘
                            ▼
                          Reader
                            │
                            ▼
                       ActionResult
                            │
                            ▼
                   Skill.handleResult()
                            │
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
          Continue        Waiting        Success
             │                             │
             └───────────→ Next Action     ▼
                                       SkillOutput
```

同时整个过程产生：

```text
SkillEvent Stream
      │
      ├── LOG
      ├── PROGRESS
      ├── ACTION_STARTED
      ├── ACTION_COMPLETED
      ├── APDU_SENT
      ├── APDU_RECEIVED
      ├── PARSE_RESULT
      ├── WARNING
      └── ERROR
```

---

# 46. 核心设计决策

## 决策 1：保留泛型 Session

```java
Skill<S>
```

## 决策 2：Skill 不持有执行 Session

```text
Skill Definition
      ↓
Executor 创建 Session
```

## 决策 3：显式 State Machine

```java
enum Scp02State
```

## 决策 4：从 Command 模型升级为 Action 模型

```text
APDU
RESET
WAIT
CONNECT
CUSTOM
```

统一使用 Action 表达。

## 决策 5：ActionResult 不限定为 APDU Response

```text
APDU → ApduActionResult
RESET → ResetCardResult
```

## 决策 6：Skill 保留完整协议控制权

```text
Action 具体内容
Response 解析
State
计算
Output
```

全部由 Skill 决定。

## 决策 7：日志和业务结果分离

```text
SkillEvent → 过程信息
SkillOutput → 最终业务结果
```

## 决策 8：SkillSession 与 CardSession 分离

```text
SkillSession = 一次执行
CardSession = 当前 Card 生命周期
```

## 决策 9：安全状态单独隔离

```text
Protocol State
SecurityContext
```

分开管理。

## 决策 10：暂不引入 DSL

Code Skill 是当前默认开发方式。

---

# 47. 推荐落地路线

## Phase 1：核心 Action Runtime

实现：

```text
Skill
SkillSession
SkillResult
SkillAction
ActionResult
SkillExecutor
ActionExecutor
```

首先支持：

```text
APDU
RESET_CARD
```

## Phase 2：Event Stream

实现：

```text
SkillEvent
EventStream
SkillLogger
APDU Event
Action Event
```

让 Agent UI 可以实时看到 Skill 执行过程。

## Phase 3：SCP02

实现：

```text
Scp02OpenSkill
Scp02Session
Scp02State
Scp02Result
```

验证：

```text
RESET
→ INITIALIZE UPDATE
→ Derive Keys
→ EXTERNAL AUTHENTICATE
→ ESTABLISHED
```

## Phase 4：CardSession

实现：

```text
CardSession
SecureChannelContext
Reset lifecycle
```

打通：

```text
SCP02
 ↓
Secure APDU
 ↓
Profile Download
```

## Phase 5：Retry / Timeout / Cancel

补齐 Runtime 能力。

## Phase 6：Suspend / Resume

实现：

```text
SessionSnapshot
SessionStore
resume()
```

## Phase 7：更多 Skills

```text
SCP80
PIN
GlobalPlatform
Profile
OTA
```

---

# 48. 最终架构结论

SmartCard Agent Skill Runtime 最终采用：

```text
Skill
  ↓
SkillSession
  ↓
State Machine
  ↓
SkillAction
  ↓
ActionExecutor
  ↓
ActionResult
  ↓
Skill
```

并行存在：

```text
SkillEvent
  ↓
EventStream
  ↓
Agent UI
```

以及：

```text
CardSession
  ↓
SecureChannelContext
  ↓
多个后续 Skill
```

最终原则：

> **Skill 是 SmartCard 协议逻辑的拥有者；SkillSession 保存一次执行的状态；SkillAction 表达 Skill 希望 Runtime 执行的动作；ActionExecutor 负责真正执行；ActionResult 将执行结果返回 Skill；SkillEvent 向 Agent 实时输出日志和过程信息；SkillOutput 表达最终业务结果；CardSession 保存当前 Card 的长期运行上下文。**

这套架构能够统一解决：

```text
多步骤 APDU
上一条 Response 参与下一条计算
APDU + RESET 等非 APDU 操作
APDU 描述信息
Response 解析信息
字符串日志
流式日志
Agent UI 实时展示
Session 状态保持
Secure Channel 生命周期
Retry / Timeout / Cancel
Suspend / Resume
```

同时避免为了表达 SmartCard 协议而引入额外 DSL 学习成本。
