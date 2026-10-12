# Knowledge citations in the session view, opened in the side panel

English | [中文](knowledge-citation-display.zh-CN.md)

## Background and goal

When the `knowledge_retrieval` tool hits specification documents, the model cites them in its answer. Today the user cannot see, in the session, which documents and pages were cited, nor jump to the source in one click.

**Goal**: when the agent retrieves from the knowledge base and cites documents, show the hit documents in the session as **one card with a list** (document name + page, no count cap), and open the cited page of a document as an **embedded PDF in the right-hand panel** when a row is clicked.

The interaction mirrors the existing "agent writes a file → session shows the file → click to view on the right" experience, but reuses the artifact channel rather than the file-change channel.

## Current mechanisms to reuse (investigation findings)

| Stage                                 | Existing mechanism                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured data from tool to frontend | `ToolResult.artifacts` (`ToolArtifact[]`) → emitter writes `_meta.artifacts` → bridge persists a `DaemonSessionArtifact` and broadcasts `artifact_changed` → frontend `useSessionArtifacts` |
| Session card                          | `TurnOutputs` (`packages/web-shell/client/components/artifacts/TurnOutputs.tsx`), attributed to the current turn by `toolCallId`                                                            |
| Right panel                           | `ArtifactDetail` / render dispatch in `ArtifactPanel.tsx`                                                                                                                                   |
| Embedded PDF                          | existing `PdfAttachmentPreview` (`<iframe src={objectUrl}>`)                                                                                                                                |
| Document content endpoint             | `GET {retrievalUrl}/api/docs/{document_id}/pages?start_page&end_page` → the page range as an `inline` PDF                                                                                   |

**Conclusion**: the backbone reuses `ToolResult.artifacts → DaemonSessionArtifact → TurnOutputs → ArtifactPanel`, with **no new daemon route and no ACP protocol change**. The only additions are: (1) the tool produces artifacts; (2) the frontend renders "knowledge citation" artifacts as a list block; (3) the side panel embeds a remote PDF.

## Design

### A. core (produce structured citations)

`execute()` in `packages/core/src/knowledge/tools/retrieval.ts` emits a `ToolArtifact` per retrieved result:

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

- `title` makes the list row read "document name + page".
- `kind: 'pdf'` (**not `link`**: a `link` artifact opens in a new tab instead of the side panel).
- The page range is the min/max of the citation's `page_nos`; with no pages it falls back to `/file` (whole document).
- No count cap.

`packages/core/src/knowledge/types.ts`: add `file_path?: string` to `KnowledgeResultCitation` (the server already returns it; the type just omitted it).

### B. web-shell (one card, a list, embedded PDF)

| File                                     | Change                                                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/artifacts/TurnOutputs.tsx`   | Render the artifacts with `toolName === 'knowledge_retrieval'` as **one list block** (each row: icon + document name + page); clicking a row opens the side panel. Other artifacts still use `ArtifactCard` |
| `components/artifacts/ArtifactPanel.tsx` | In `ArtifactDetail`, add an **embedded `<iframe>` preview** for `storage === 'external_url'` and `kind === 'pdf'` (reusing the `PdfAttachmentPreview` objectUrl pattern)                                    |

The list block follows the house presentation of "single card + list rows + click a row to open the side detail", and **does not truncate the count**.

### Key decisions

| Decision                  | Choice                                          | Rationale                                                                                                                                       |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Which documents are shown | All hits from this retrieval (A1)               | The tool cannot know whether the model ultimately cited one; a hit is relevant. Parsing the answer text to match citations is complex and leaky |
| List shape                | One card + list rows, no count cap              | Explicit user requirement (2026-10-12)                                                                                                          |
| Open behavior             | Embedded PDF in the side panel                  | Matches the "write file" experience                                                                                                             |
| Document address          | `document_id` joined onto the `/pages` endpoint | Stable; `file_path` may be a local absolute path the frontend cannot reach                                                                      |
| Page targeting            | `/pages?start_page&end_page`                    | Server already supports it and returns the page range as an inline PDF, matching the cited page                                                 |

## Data flow

```
knowledge_retrieval.execute()
  └─ ToolResult.artifacts: ToolArtifact[]   (kind=pdf, storage=external_url, url=/api/docs/{id}/pages?…)
       └─ ACP tool_call_update._meta.artifacts
            └─ bridge: DaemonSessionArtifact + artifact_changed event
                 └─ web-shell useSessionArtifacts → attributed to turn (toolCallId)
                      └─ TurnOutputs list block (one card, N rows)
                           └─ click a row → ArtifactPanel embeds <iframe src="/api/docs/{id}/pages?…">
```

## Verification

1. **core unit test**: `retrieval.test.ts` asserts the returned `artifacts` shape (title has pages, url points at `/pages`, kind=pdf, storage=external_url).
2. **web-shell unit tests**: `TurnOutputs` renders a list block for `knowledge_retrieval` artifacts and wires the click; `ArtifactDetail` renders an iframe for external_url pdf.
3. **End-to-end**: ask in the desktop app → the agent retrieves → the session shows a document list → click → the side panel embeds the PDF.

## Blast radius

- The feature is isolated in `packages/core/src/knowledge/`; frontend changes are confined to `TurnOutputs.tsx` and `ArtifactPanel.tsx`.
- Does not affect the `write_file` file-change card (the two channels are independent).
- No daemon route change, no ACP protocol change.
