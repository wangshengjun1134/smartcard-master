/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
  KnowledgeRetrievalError,
  resolveKnowledgeTimeoutMs,
  searchKnowledge,
} from './retrieval-client.js';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('searchKnowledge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to /api/v1/rag/search on the configured base URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await searchKnowledge('http://127.0.0.1:8000', {
      query: 'profile isolation',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8000/api/v1/rag/search');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'profile isolation',
    });
  });

  it('strips a trailing slash before joining the path', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await searchKnowledge('http://127.0.0.1:8000/', { query: 'x' });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('http://127.0.0.1:8000/api/v1/rag/search');
  });

  it('returns the parsed results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          query: 'q',
          total: 1,
          reranked: true,
          results: [
            {
              chunk_id: 'c1',
              document_id: 'd1',
              score: 4.53,
              content: 'body',
              metadata: { heading_path: 'A > B', page_nos: [180] },
              citation: { series_id: 'SGP.27', revision: '1.0' },
              extra_field: 'dropped',
            },
          ],
        }),
      ),
    );

    const result = await searchKnowledge('http://127.0.0.1:8000', {
      query: 'q',
    });

    expect(result.total).toBe(1);
    expect(result.reranked).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      chunk_id: 'c1',
      document_id: 'd1',
      score: 4.53,
      content: 'body',
      citation: { series_id: 'SGP.27', revision: '1.0' },
    });
    // Unknown backend extras are not echoed back.
    expect(result.results[0]).not.toHaveProperty('extra_field');
  });

  it('throws a readable error on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('{"error":"bad"}', { status: 400 })),
    );

    await expect(
      searchKnowledge('http://127.0.0.1:8000', { query: 'q' }),
    ).rejects.toThrow(/HTTP 400/);
  });

  it('throws when the service is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );

    await expect(
      searchKnowledge('http://127.0.0.1:8000', { query: 'q' }),
    ).rejects.toThrow(KnowledgeRetrievalError);
  });

  it('throws when results is missing from the payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ total: 0 })),
    );

    await expect(
      searchKnowledge('http://127.0.0.1:8000', { query: 'q' }),
    ).rejects.toThrow(/results/);
  });

  it('applies a request timeout by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);

    await searchKnowledge('http://127.0.0.1:8000', { query: 'q' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('exports a positive default timeout', () => {
    expect(DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe('resolveKnowledgeTimeoutMs', () => {
  it('converts configured seconds to milliseconds', () => {
    expect(resolveKnowledgeTimeoutMs(30)).toBe(30_000);
    expect(resolveKnowledgeTimeoutMs(1)).toBe(1_000);
    expect(resolveKnowledgeTimeoutMs(3600)).toBe(3_600_000);
  });

  it('falls back to the default when unset', () => {
    expect(resolveKnowledgeTimeoutMs(undefined)).toBe(
      DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
    );
  });

  it('falls back to the default for out-of-range values', () => {
    expect(resolveKnowledgeTimeoutMs(0)).toBe(
      DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
    );
    expect(resolveKnowledgeTimeoutMs(-5)).toBe(
      DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
    );
    expect(resolveKnowledgeTimeoutMs(99_999)).toBe(
      DEFAULT_KNOWLEDGE_SEARCH_TIMEOUT_MS,
    );
  });
});
