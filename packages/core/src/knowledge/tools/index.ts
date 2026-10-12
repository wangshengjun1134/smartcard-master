/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolRegistry } from '../../tools/tool-registry.js';
import { KnowledgeRetrievalTool } from './retrieval.js';

export { KnowledgeRetrievalTool } from './retrieval.js';
export type { KnowledgeRetrievalParams } from './retrieval.js';

/** Register the knowledge retrieval tool eagerly against the given registry. */
export function registerKnowledgeTools(
  registry: ToolRegistry,
  retrievalUrl: string,
): void {
  registry.registerTool(new KnowledgeRetrievalTool(retrievalUrl));
}
