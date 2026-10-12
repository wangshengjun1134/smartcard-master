/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings for the built-in knowledge retrieval tool, resolved by the CLI
 * config loader from `knowledge.retrievalUrl`. Undefined when the feature is
 * not configured — the tool is then not registered at all.
 */
export interface KnowledgeRetrievalSettings {
  /** Base URL of the knowledge retrieval service. */
  retrievalUrl: string;
}

export type KnowledgeVersionPolicy = 'latest' | 'exact' | 'selected' | 'all';

export type KnowledgeRetrievalType = 'vector' | 'keyword' | 'hybrid';

export interface KnowledgeScope {
  series_id?: string[];
  document_id?: string[];
  revision?: string[];
  version_policy?: KnowledgeVersionPolicy;
}

export interface KnowledgeRetrievalOptions {
  retrieval_type?: KnowledgeRetrievalType;
  top_k?: number;
  rerank_enabled?: boolean;
  rerank_top_k?: number;
  similarity_threshold?: number | null;
}

export interface KnowledgeFilters {
  page_id?: string[];
  heading_path?: string | null;
  language?: string | null;
}

export interface KnowledgeProjectionOptions {
  include_content?: boolean;
  include_metadata?: boolean;
  include_citations?: boolean;
}

/** Request body for `POST /api/v1/rag/search`. */
export interface KnowledgeSearchRequest {
  query: string;
  scope?: KnowledgeScope;
  retrieval?: KnowledgeRetrievalOptions;
  filters?: KnowledgeFilters;
  options?: KnowledgeProjectionOptions;
}

export interface KnowledgeResultMetadata {
  headings?: string[];
  heading_path?: string;
  page_nos?: number[];
  token_count?: number;
  chunk_token_limit?: number;
  chunk_tokenizer?: string;
}

export interface KnowledgeResultCitation {
  document_name?: string;
  document_code?: string;
  series_id?: string;
  revision?: string;
  page_nos?: number[];
  linked_item_ids?: string[];
}

export interface KnowledgeResultItem {
  chunk_id: string;
  document_id?: string;
  score?: number;
  score_stage?: string;
  content?: string;
  metadata?: KnowledgeResultMetadata;
  citation?: KnowledgeResultCitation;
}

export interface KnowledgeSearchResponse {
  query?: string;
  total?: number;
  reranked?: boolean;
  profile?: string;
  timing_ms?: { retrieval?: number; rerank?: number; total?: number };
  results: KnowledgeResultItem[];
}
