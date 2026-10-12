/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { Config } from '../config/config.js';
import { ToolNames } from '../tools/tool-names.js';
import { buildKnowledgeGuidanceSection } from './guidance.js';

function fakeConfig(options: {
  settings?: { retrievalUrl: string } | undefined;
  disabled?: string[];
}): Config {
  return {
    getKnowledgeRetrievalSettings: () => options.settings,
    getDisabledTools: () => new Set(options.disabled ?? []),
  } as unknown as Config;
}

describe('buildKnowledgeGuidanceSection', () => {
  it('returns null when knowledge retrieval is not configured', () => {
    expect(buildKnowledgeGuidanceSection(fakeConfig({}))).toBeNull();
  });

  it('returns guidance naming the built-in tool when configured', () => {
    const section = buildKnowledgeGuidanceSection(
      fakeConfig({ settings: { retrievalUrl: 'http://127.0.0.1:8000' } }),
    );
    expect(section).toContain(ToolNames.KNOWLEDGE_RETRIEVAL);
    // Describes the knowledge base scope so the model can judge when to use it.
    expect(section).toContain('智能卡');
    expect(section).toContain('01-foundation');
    // Constrains HOW to retrieve: the tool, not a scripted HTTP call.
    expect(section).toContain('不要用 shell');
  });

  it('returns null when the tool is disabled', () => {
    const section = buildKnowledgeGuidanceSection(
      fakeConfig({
        settings: { retrievalUrl: 'http://127.0.0.1:8000' },
        disabled: [ToolNames.KNOWLEDGE_RETRIEVAL],
      }),
    );
    expect(section).toBeNull();
  });
});
