/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolArtifact } from '../tools/tools.js';
import type {
  KnowledgeResultCitation,
  KnowledgeSearchResponse,
} from './types.js';

/** Default base URL when `knowledge.retrievalUrl` was not provided. */
const DEFAULT_RETRIEVAL_URL = 'http://127.0.0.1:8000';

function normalizeBase(retrievalUrl: string | undefined): string {
  const trimmed = retrievalUrl?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : DEFAULT_RETRIEVAL_URL;
}

/** The pages a citation points at, ascending and de-duplicated. */
function citationPages(
  citation: KnowledgeResultCitation,
  fallback: readonly number[] | undefined,
): number[] {
  const raw = citation.page_nos?.length ? citation.page_nos : (fallback ?? []);
  const valid = raw.filter(
    (page): page is number => Number.isInteger(page) && page > 0,
  );
  return [...new Set(valid)].sort((a, b) => a - b);
}

function citationTitle(
  citation: KnowledgeResultCitation,
  pages: readonly number[],
): string {
  const name = citation.document_name || citation.document_code || '未知文档';
  return pages.length > 0 ? `${name} · p.${pages.join(',')}` : name;
}

/**
 * Document URL the side panel embeds. Uses the service page endpoint so the
 * panel shows the cited page range directly; falls back to the whole file when
 * the citation carries no page number. The service returns an inline PDF.
 */
function citationUrl(
  retrievalUrl: string | undefined,
  documentId: string,
  pages: readonly number[],
): string {
  const base = normalizeBase(retrievalUrl);
  if (pages.length > 0) {
    const start = pages[0];
    const end = pages[pages.length - 1];
    return `${base}/api/docs/${encodeURIComponent(documentId)}/pages?start_page=${start}&end_page=${end}`;
  }
  return `${base}/api/docs/${encodeURIComponent(documentId)}/file`;
}

/**
 * Maps each retrieved result to a `ToolArtifact` so the session view can list
 * the cited documents (name + page) and open the cited page in the side panel.
 * One artifact per result — the count is not capped, matching the requirement
 * to show every hit.
 */
export function buildCitationArtifacts(
  response: KnowledgeSearchResponse,
  retrievalUrl: string | undefined,
): ToolArtifact[] {
  const artifacts: ToolArtifact[] = [];
  for (const item of response.results) {
    const documentId = item.document_id;
    // Without a document id there is no service endpoint to open.
    if (!documentId) continue;
    const citation = item.citation ?? {};
    const pages = citationPages(citation, item.metadata?.page_nos);
    artifacts.push({
      kind: 'pdf',
      storage: 'external_url',
      title: citationTitle(citation, pages),
      url: citationUrl(retrievalUrl, documentId, pages),
      mimeType: 'application/pdf',
      metadata: {
        documentId,
        ...(pages.length > 0 ? { pageNos: pages.join(',') } : {}),
        ...(citation.series_id ? { seriesId: citation.series_id } : {}),
        ...(citation.revision ? { revision: citation.revision } : {}),
        ...(citation.document_code
          ? { documentCode: citation.document_code }
          : {}),
      },
    });
  }
  return artifacts;
}
