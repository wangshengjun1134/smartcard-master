# 知识库引用在会话区的展示与右侧打开

[English](knowledge-citation-display.md) | 中文

## 背景与目标

知识检索工具 `knowledge_retrieval` 命中规范文档后，模型会在答案里引用这些文档。目前用户无法在会话里直接看到「引用了哪些文档、哪些页」，也无法一键跳到原文。

**目标**：当 agent 通过知识库检索并在答案中引用文档时，在会话区以**一张卡片 + 列表**的形式列出命中文档（文档名 + 页码，不限条数），点击某一行在右侧面板**内嵌打开该文档对应页的 PDF**。

交互对齐已有的「agent 写文件 → 会话区显示文件 → 点击右侧看内容」体验，但复用 artifact 通道而非文件变更通道。

## 现状与可复用机制（调研结论）

| 环节                   | 现成机制                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 结构化数据从工具到前端 | `ToolResult.artifacts`（`ToolArtifact[]`）→ emitter 写入 `_meta.artifacts` → bridge 落库为 `DaemonSessionArtifact` 并广播 `artifact_changed` → 前端 `useSessionArtifacts` |
| 会话区卡片             | `TurnOutputs`（`packages/web-shell/client/components/artifacts/TurnOutputs.tsx`），按 `toolCallId` 归属到当前 turn                                                        |
| 右侧面板               | `ArtifactPanel` 的 `ArtifactDetail` / 渲染分发（`ArtifactPanel.tsx`）                                                                                                     |
| 内嵌 PDF               | 已有 `PdfAttachmentPreview`（`<iframe src={objectUrl}>`，`ArtifactPanel.tsx`）                                                                                            |
| 文档内容端点           | 知识库服务 `GET {retrievalUrl}/api/docs/{document_id}/pages?start_page&end_page` → 返回该页范围的 `inline` PDF                                                            |

**结论**：主干复用 `ToolResult.artifacts → DaemonSessionArtifact → TurnOutputs → ArtifactPanel`，**零新增 daemon 路由、零 ACP 协议改动**。唯一需要新增的是：①工具产出 artifact；②前端把「知识引用」一类 artifact 渲染成列表区块；③右侧面板内嵌远程 PDF。

## 方案

### A. core（产出结构化引用）

`packages/core/src/knowledge/tools/retrieval.ts` 的 `execute()` 为**每条检索结果**产出 `ToolArtifact`：

```ts
{
  kind: 'pdf',
  storage: 'external_url',
  title: `${document_name} · p.${page_nos.join(',')}`,
  url: `${retrievalUrl}/api/docs/${document_id}/pages?start_page=${min}&end_page=${max}`,
  mimeType: 'application/pdf',
  metadata: { page_nos, document_id, series_id, revision },
}
```

- `title` 让列表行天然显示「文档名 + 页码」。
- `kind: 'pdf'`（**不是 `link`**，`link` 会被当作外链新标签页打开，而非进入右侧面板）。
- 页码范围取该 citation 的 `page_nos` 最小/最大值；无页码时退回 `/file`（整份）。
- 条数不设上限。

`packages/core/src/knowledge/types.ts`：`KnowledgeResultCitation` 补 `file_path?: string`（服务端实际已返回，类型未声明）。

### B. web-shell（一张卡片 + 列表 + 内嵌 PDF）

| 文件                                     | 改动                                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/artifacts/TurnOutputs.tsx`   | 将 `toolName === 'knowledge_retrieval'` 的 artifacts 聚合渲染为**一个列表区块**（每行：图标 + 文档名 + 页码），点击行打开右侧面板；其余 artifact 仍走 `ArtifactCard` |
| `components/artifacts/ArtifactPanel.tsx` | `ArtifactDetail` 对 `storage === 'external_url'` 且 `kind === 'pdf'` 的分支新增**内嵌 `<iframe>` 预览**（复用 `PdfAttachmentPreview` 的 objectUrl 模式）             |

列表区块遵循「单卡片 + 列表行 + 点击行打开右侧详情」的既有呈现惯例，**不做条数截断**。

### 关键决策

| 决策         | 选择                           | 理由                                                                     |
| ------------ | ------------------------------ | ------------------------------------------------------------------------ |
| 显示哪些文档 | 本次检索命中的全部（A1）       | 工具层无法判定模型最终是否引用，命中即相关；解析答案文本匹配既复杂又易漏 |
| 列表形态     | 一张卡片 + 列表行，不限条数    | 用户 2026-10-12 明确要求                                                 |
| 打开方式     | 右侧面板内嵌 PDF               | 与「写文件」体验一致                                                     |
| 文档地址     | `document_id` 拼 `/pages` 端点 | 稳定；`file_path` 可能是本地绝对路径，前端未必可达                       |
| 页码定位     | `/pages?start_page&end_page`   | 服务端已支持，返回该页范围内嵌 PDF，精准对应引用页                       |

## 数据链路

```
knowledge_retrieval.execute()
  └─ ToolResult.artifacts: ToolArtifact[]   (kind=pdf, storage=external_url, url=/api/docs/{id}/pages?…)
       └─ ACP tool_call_update._meta.artifacts
            └─ bridge: DaemonSessionArtifact + artifact_changed 事件
                 └─ web-shell useSessionArtifacts → 归属到 turn（toolCallId）
                      └─ TurnOutputs 列表区块（一个卡片，N 行）
                           └─ 点击行 → ArtifactPanel 内嵌 <iframe src="/api/docs/{id}/pages?…">
```

## 验证

1. **core 单测**：`retrieval.test.ts` 断言 `execute()` 返回的 `artifacts` 结构（title 含页码、url 指向 `/pages`、kind=pdf、storage=external_url）。
2. **web-shell 单测**：`TurnOutputs` 对 `knowledge_retrieval` artifacts 渲染列表区块、点击回调；`ArtifactDetail` 对 external_url pdf 渲染 iframe。
3. **端到端**：桌面应用发问 → agent 检索 → 会话区出现文档列表 → 点击 → 右侧内嵌 PDF。

## 影响面

- 新功能隔离在 `packages/core/src/knowledge/`；前端改动集中在 `TurnOutputs.tsx` 与 `ArtifactPanel.tsx`。
- 不影响 `write_file` 的文件变更卡片（两条通道各自独立）。
- 无 daemon 路由、无 ACP 协议改动。
