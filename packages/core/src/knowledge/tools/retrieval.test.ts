/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeRetrievalTool } from './retrieval.js';

const URL = 'http://127.0.0.1:8000';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function invocation(
  tool: KnowledgeRetrievalTool,
  params: Parameters<typeof tool.validateToolParams>[0],
) {
  return (
    tool as unknown as {
      createInvocation(p: unknown): { execute(): Promise<unknown> };
    }
  ).createInvocation(params);
}

describe('KnowledgeRetrievalTool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes the registered tool name', () => {
    expect(KnowledgeRetrievalTool.Name).toBe('knowledge_retrieval');
  });

  it('declares query as the only required parameter', () => {
    const tool = new KnowledgeRetrievalTool(URL);
    expect(tool.schema.parametersJsonSchema).toMatchObject({
      type: 'object',
      required: ['query'],
      additionalProperties: false,
    });
  });

  it('builds the request with scope and top_k defaults', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const tool = new KnowledgeRetrievalTool(URL);

    await invocation(tool, {
      query: 'profile isolation',
      series_id: ['SGP.27'],
      top_k: 5,
    }).execute();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'profile isolation',
      scope: { series_id: ['SGP.27'] },
      retrieval: { top_k: 5, rerank_top_k: 5 },
    });
  });

  it('defaults top_k when omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const tool = new KnowledgeRetrievalTool(URL);

    await invocation(tool, { query: 'x' }).execute();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      query: 'x',
      retrieval: { top_k: 5, rerank_top_k: 5 },
    });
  });

  it('formats results with citation and page information', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          reranked: true,
          results: [
            {
              chunk_id: 'c1',
              score: 4.53,
              score_stage: 'rerank',
              content: 'Profile isolation requires...',
              metadata: { heading_path: '4 > 4.2 > 4.2.18' },
              citation: {
                document_name: 'SGP.27-v1.0.pdf',
                series_id: 'SGP.27',
                revision: '1.0',
                page_nos: [180],
              },
            },
          ],
        }),
      ),
    );
    const tool = new KnowledgeRetrievalTool(URL);

    const result = (await invocation(tool, { query: 'q' }).execute()) as {
      llmContent: string;
    };

    expect(result.llmContent).toContain('SGP.27-v1.0.pdf');
    expect(result.llmContent).toContain('4.530');
    expect(result.llmContent).toContain('pages=180');
    expect(result.llmContent).toContain('section=4 > 4.2 > 4.2.18');
    expect(result.llmContent).toContain('Profile isolation requires...');
  });

  it('reports an empty result set without failing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ results: [] })),
    );
    const tool = new KnowledgeRetrievalTool(URL);

    const result = (await invocation(tool, { query: 'q' }).execute()) as {
      llmContent: string;
      error?: unknown;
    };

    expect(result.error).toBeUndefined();
    expect(result.llmContent).toContain('未在知识库中检索到相关内容');
  });

  it('surfaces a readable failure when the service errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 500 })),
    );
    const tool = new KnowledgeRetrievalTool(URL);

    const result = (await invocation(tool, { query: 'q' }).execute()) as {
      llmContent: string;
      error?: { message: string };
    };

    expect(result.error).toBeDefined();
    expect(result.llmContent).toContain('HTTP 500');
  });
});
