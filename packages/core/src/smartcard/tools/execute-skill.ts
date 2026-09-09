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
import { smartcardExecuteSkill } from '../daemon-client.js';

export interface SmartCardExecuteSkillParams {
  skillId: string;
  input?: Record<string, unknown>;
}

class SmartCardExecuteSkillInvocation extends BaseToolInvocation<
  SmartCardExecuteSkillParams,
  ToolResult
> {
  constructor(params: SmartCardExecuteSkillParams) {
    super(params);
  }

  getDescription(): string {
    return `Execute smart card skill "${this.params.skillId}"`;
  }

  async execute(): Promise<ToolResult> {
    const result = await smartcardExecuteSkill(
      this.params.skillId,
      this.params.input ?? {},
    );

    const lines = [
      `Status: ${result.status}`,
      ...(result.error ? [`Error: ${result.error}`] : []),
      ...result.events.map((event) => {
        const body =
          event.level === 'DATA' ? JSON.stringify(event.data) : event.message;
        return `[${event.level}] ${body}`;
      }),
    ];
    const content = lines.join('\n');
    return {
      llmContent: content,
      returnDisplay: content,
      ...(result.status === 'FAILED' || result.status === 'CANCELLED'
        ? { error: { message: result.error ?? result.status } }
        : {}),
    };
  }
}

export class SmartCardExecuteSkillTool extends BaseDeclarativeTool<
  SmartCardExecuteSkillParams,
  ToolResult
> {
  static readonly Name = ToolNames.SMARTCARD_EXECUTE_SKILL;

  constructor() {
    super(
      SmartCardExecuteSkillTool.Name,
      ToolDisplayNames.SMARTCARD_EXECUTE_SKILL,
      'Execute a registered smart card skill. Built-in skills include ' +
        '"scp02.open" (establish a GlobalPlatform SCP02 secure channel). ' +
        'Use smartcard_connect first so a reader is active.',
      Kind.Other,
      {
        type: 'object',
        properties: {
          skillId: {
            type: 'string',
            description: 'The skill id to execute (e.g. "scp02.open").',
          },
          input: {
            type: 'object',
            description: 'Skill-specific input parameters.',
          },
        },
        required: ['skillId'],
        additionalProperties: false,
      },
      false, // isOutputMarkdown
      false, // canUpdateOutput
      false, // shouldDefer
      false, // alwaysLoad
      'smartcard skill scp02 secure channel',
    );
  }

  protected createInvocation(
    params: SmartCardExecuteSkillParams,
  ): ToolInvocation<SmartCardExecuteSkillParams, ToolResult> {
    return new SmartCardExecuteSkillInvocation(params);
  }
}
