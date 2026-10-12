/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  KnowledgeSearchRequest,
  KnowledgeSearchResponse,
} from './types.js';

/** Per-request budget for one knowledge retrieval, matching the WebSearch default. */
export const KNOWLEDGE_SEARCH_TIMEOUT_MS = 30_000;

const DEFAULT_RETRIEVAL_URL = 'http://127.0.0.1:8000';

/**
 * Error raised when a knowledge retrieval call cannot be completed. The
 * message is written to be surfaced verbatim to the model, so it must be a
 * complete, actionable sentence.
 */
export class KnowledgeRetrievalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeRetrievalError';
  }
}

function normalizeBase(retrievalUrl: string | undefined): string {
  const trimmed = retrievalUrl?.trim();
  return trimmed ? trimmed : DEFAULT_RETRIEVAL_URL;
}

function resolveSearchUrl(retrievalUrl: string | undefined): string {
  return new URL('/api/v1/rag/search', normalizeBase(retrievalUrl)).toString();
}

function combineSignals(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = (await response.text()).trim();
    return text ? `: ${text.slice(0, 500)}` : '';
  } catch {
    return '';
  }
}

/**
 * Normalize one result item to the fields the tool renders. Keeps unknown
 * backend extras out of the tool output while retaining everything the v2
 * contract defines.
 */
function normalizeItem(
  item: unknown,
): KnowledgeSearchResponse['results'][number] {
  const record = (item ?? {}) as Record<string, unknown>;
  return {
    chunk_id: typeof record['chunk_id'] === 'string' ? record['chunk_id'] : '',
    ...(typeof record['document_id'] === 'string'
      ? { document_id: record['document_id'] }
      : {}),
    ...(typeof record['score'] === 'number' ? { score: record['score'] } : {}),
    ...(typeof record['score_stage'] === 'string'
      ? { score_stage: record['score_stage'] }
      : {}),
    ...(typeof record['content'] === 'string'
      ? { content: record['content'] }
      : {}),
    ...(record['metadata'] && typeof record['metadata'] === 'object'
      ? {
          metadata: record[
            'metadata'
          ] as KnowledgeSearchResponse['results'][number]['metadata'],
        }
      : {}),
    ...(record['citation'] && typeof record['citation'] === 'object'
      ? {
          citation: record[
            'citation'
          ] as KnowledgeSearchResponse['results'][number]['citation'],
        }
      : {}),
  };
}

/**
 * Call `POST {retrievalUrl}/api/v1/rag/search` and return the parsed response.
 * Every failure path throws {@link KnowledgeRetrievalError} with a message the
 * tool surfaces to the model.
 */
export async function searchKnowledge(
  retrievalUrl: string,
  params: KnowledgeSearchRequest,
  signal?: AbortSignal,
): Promise<KnowledgeSearchResponse> {
  let url: string;
  try {
    url = resolveSearchUrl(retrievalUrl);
  } catch {
    throw new KnowledgeRetrievalError(
      `知识库检索地址无效：${retrievalUrl}。请在设置中配置有效的 knowledge.retrievalUrl。`,
    );
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
      signal: combineSignals(signal, KNOWLEDGE_SEARCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new KnowledgeRetrievalError(
      `调用知识库检索接口失败（${url}）：${
        error instanceof Error ? error.message : String(error)
      }。请确认知识库服务已启动且地址可达。`,
    );
  }

  if (!response.ok) {
    const detail = await readErrorBody(response);
    throw new KnowledgeRetrievalError(
      `知识库检索接口返回 HTTP ${response.status}${detail}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new KnowledgeRetrievalError('知识库检索接口返回了无法解析的响应。');
  }

  const record = (payload ?? {}) as Record<string, unknown>;
  if (!Array.isArray(record['results'])) {
    throw new KnowledgeRetrievalError(
      '知识库检索接口响应缺少 results 数组，无法解析结果。',
    );
  }

  return {
    ...(typeof record['query'] === 'string' ? { query: record['query'] } : {}),
    ...(typeof record['total'] === 'number' ? { total: record['total'] } : {}),
    ...(typeof record['reranked'] === 'boolean'
      ? { reranked: record['reranked'] }
      : {}),
    ...(typeof record['profile'] === 'string'
      ? { profile: record['profile'] }
      : {}),
    ...(record['timing_ms'] && typeof record['timing_ms'] === 'object'
      ? {
          timing_ms: record[
            'timing_ms'
          ] as KnowledgeSearchResponse['timing_ms'],
        }
      : {}),
    results: record['results'].map(normalizeItem),
  };
}
