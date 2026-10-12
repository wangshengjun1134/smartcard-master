/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolInvocation, ToolResult } from '../../tools/tools.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
} from '../../tools/tools.js';
import { ToolNames, ToolDisplayNames } from '../../tools/tool-names.js';
import {
  KnowledgeRetrievalError,
  resolveKnowledgeTimeoutMs,
  searchKnowledge,
} from '../retrieval-client.js';
import { buildCitationArtifacts } from '../citations.js';
import type { KnowledgeSearchResponse } from '../types.js';

export interface KnowledgeRetrievalParams {
  /** Natural-language search query. */
  query: string;
  /** Restrict the search to one or more specification series (e.g. SGP.27). */
  series_id?: string[];
  /** Maximum number of results to return. */
  top_k?: number;
  /** Retrieval pipeline to use. */
  retrieval_type?: 'vector' | 'keyword' | 'hybrid';
}

// CPU-side reranking is slow, so keep the default candidate pool and the
// reranked output small. rerank_top_k must not exceed top_k or the service
// rejects the request with 400.
const DEFAULT_TOP_K = 5;
const DEFAULT_RERANK_TOP_K = 5;

function formatScore(score: number | undefined): string {
  return typeof score === 'number' ? score.toFixed(3) : 'n/a';
}

function formatResultItem(
  item: KnowledgeSearchResponse['results'][number],
  index: number,
): string {
  const citation = item.citation ?? {};
  const metadata = item.metadata ?? {};
  const title =
    citation.document_name ||
    citation.document_code ||
    item.document_id ||
    '未知文档';
  const pages = citation.page_nos ?? metadata.page_nos;
  const lines = [
    `[${index + 1}] ${title}`,
    `    score=${formatScore(item.score)}${
      item.score_stage ? ` (${item.score_stage})` : ''
    }`,
  ];
  if (citation.series_id || citation.revision) {
    lines.push(
      `    series=${citation.series_id ?? '?'} revision=${citation.revision ?? '?'}`,
    );
  }
  if (pages && pages.length > 0) {
    lines.push(`    pages=${pages.join(',')}`);
  }
  if (metadata.heading_path) {
    lines.push(`    section=${metadata.heading_path}`);
  }
  if (item.content) {
    lines.push('', item.content);
  }
  return lines.join('\n');
}

function formatResponse(response: KnowledgeSearchResponse): string {
  if (response.results.length === 0) {
    return '未在知识库中检索到相关内容。';
  }
  const header =
    `知识库检索结果（共 ${response.results.length} 条` +
    `${response.reranked ? '，已重排' : ''}）：`;
  const body = response.results
    .map((item, index) => formatResultItem(item, index))
    .join('\n\n');
  return `${header}\n\n${body}`;
}

class KnowledgeRetrievalInvocation extends BaseToolInvocation<
  KnowledgeRetrievalParams,
  ToolResult
> {
  constructor(
    params: KnowledgeRetrievalParams,
    private readonly retrievalUrl: string,
    private readonly timeoutSeconds?: number,
  ) {
    super(params);
  }

  getDescription(): string {
    const scope = this.params.series_id?.length
      ? `（范围：${this.params.series_id.join(', ')}）`
      : '';
    return `知识库检索：${this.params.query}${scope}`;
  }

  async execute(): Promise<ToolResult> {
    const { query, series_id, top_k, retrieval_type } = this.params;
    const resolvedTopK = top_k ?? DEFAULT_TOP_K;
    try {
      const response = await searchKnowledge(
        this.retrievalUrl,
        {
          query,
          ...(series_id && series_id.length > 0
            ? { scope: { series_id } }
            : {}),
          retrieval: {
            ...(retrieval_type ? { retrieval_type } : {}),
            top_k: resolvedTopK,
            // rerank_top_k must not exceed top_k or the service returns 400.
            rerank_top_k: Math.min(DEFAULT_RERANK_TOP_K, resolvedTopK),
          },
        },
        { timeoutMs: resolveKnowledgeTimeoutMs(this.timeoutSeconds) },
      );
      const content = formatResponse(response);
      return {
        llmContent: content,
        returnDisplay: content,
        artifacts: buildCitationArtifacts(response, this.retrievalUrl),
      };
    } catch (error) {
      const message =
        error instanceof KnowledgeRetrievalError
          ? error.message
          : `知识库检索失败：${
              error instanceof Error ? error.message : String(error)
            }`;
      return {
        llmContent: message,
        returnDisplay: message,
        error: { message },
      };
    }
  }
}

export class KnowledgeRetrievalTool extends BaseDeclarativeTool<
  KnowledgeRetrievalParams,
  ToolResult
> {
  static readonly Name = ToolNames.KNOWLEDGE_RETRIEVAL;

  constructor(
    private readonly retrievalUrl: string,
    /** Configured timeout in seconds; undefined uses the built-in default. */
    private readonly timeoutSeconds?: number,
  ) {
    super(
      KnowledgeRetrievalTool.Name,
      ToolDisplayNames.KNOWLEDGE_RETRIEVAL,
      '在智能卡知识库中检索规范文档内容。当用户询问规范要求、协议细节或技术要求时使用，' +
        '返回匹配的文档片段、页码与来源引用。',
      Kind.Other,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: '检索用的自然语言查询语句。',
          },
          series_id: {
            type: 'array',
            items: { type: 'string' },
            description:
              '限定检索的规范系列，例如 ["SGP.27"]。留空则跨系列检索。',
          },
          top_k: {
            type: 'number',
            description: `初步召回的结果数量上限，默认 ${DEFAULT_TOP_K}（重排后返回前 ${DEFAULT_RERANK_TOP_K} 条）。`,
          },
          retrieval_type: {
            type: 'string',
            enum: ['vector', 'keyword', 'hybrid'],
            description:
              '检索管线：vector（向量）、keyword（关键词）、hybrid（混合）。默认 hybrid。',
          },
        },
        required: ['query'],
        additionalProperties: false,
      },
      false, // isOutputMarkdown
      false, // canUpdateOutput
      false, // shouldDefer
      false, // alwaysLoad
      'knowledge rag retrieval 知识库 检索 规范 文档',
    );
  }

  protected createInvocation(
    params: KnowledgeRetrievalParams,
  ): ToolInvocation<KnowledgeRetrievalParams, ToolResult> {
    return new KnowledgeRetrievalInvocation(
      params,
      this.retrievalUrl,
      this.timeoutSeconds,
    );
  }
}
