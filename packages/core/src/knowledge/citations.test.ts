/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildCitationArtifacts } from './citations.js';
import type { KnowledgeSearchResponse } from './types.js';

const BASE = 'http://127.0.0.1:8000';

function response(
  results: KnowledgeSearchResponse['results'],
): KnowledgeSearchResponse {
  return { results };
}

describe('buildCitationArtifacts', () => {
  it('maps one artifact per result with a page-range url', () => {
    const artifacts = buildCitationArtifacts(
      response([
        {
          chunk_id: 'c1',
          document_id: 'doc-1',
          citation: {
            document_name: 'SGP.23-v1.16.pdf',
            series_id: 'SGP.23',
            revision: '1.16',
            page_nos: [180],
          },
        },
      ]),
      BASE,
    );

    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      kind: 'pdf',
      storage: 'external_url',
      title: 'SGP.23-v1.16.pdf · p.180',
      url: `${BASE}/api/docs/doc-1/pages?start_page=180&end_page=180`,
      mimeType: 'application/pdf',
    });
    expect(artifacts[0].metadata).toMatchObject({
      documentId: 'doc-1',
      pageNos: '180',
      seriesId: 'SGP.23',
      revision: '1.16',
    });
  });

  it('uses the min/max page when a citation spans several pages', () => {
    const artifacts = buildCitationArtifacts(
      response([
        {
          chunk_id: 'c1',
          document_id: 'doc-1',
          citation: { document_name: 'X.pdf', page_nos: [100, 99, 101] },
        },
      ]),
      BASE,
    );
    expect(artifacts[0].title).toBe('X.pdf · p.99,100,101');
    expect(artifacts[0].url).toBe(
      `${BASE}/api/docs/doc-1/pages?start_page=99&end_page=101`,
    );
  });

  it('falls back to the whole-file endpoint when no page is given', () => {
    const artifacts = buildCitationArtifacts(
      response([
        {
          chunk_id: 'c1',
          document_id: 'doc-9',
          citation: { document_name: 'Y' },
        },
      ]),
      BASE,
    );
    expect(artifacts[0].url).toBe(`${BASE}/api/docs/doc-9/file`);
    expect(artifacts[0].title).toBe('Y');
  });

  it('skips results without a document id (no openable endpoint)', () => {
    const artifacts = buildCitationArtifacts(
      response([{ chunk_id: 'c1', citation: { document_name: 'Z' } }]),
      BASE,
    );
    expect(artifacts).toEqual([]);
  });

  it('keeps every result without capping the count', () => {
    const results = Array.from({ length: 12 }, (_, i) => ({
      chunk_id: `c${i}`,
      document_id: `doc-${i}`,
      citation: { document_name: `D${i}`, page_nos: [i + 1] },
    }));
    expect(buildCitationArtifacts(response(results), BASE)).toHaveLength(12);
  });

  it('normalizes a trailing slash on the base url', () => {
    const artifacts = buildCitationArtifacts(
      response([{ chunk_id: 'c1', document_id: 'd', citation: {} }]),
      `${BASE}/`,
    );
    expect(artifacts[0].url).toBe(`${BASE}/api/docs/d/file`);
  });
});
