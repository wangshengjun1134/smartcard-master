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
import { smartcardReset } from '../daemon-client.js';

export type SmartCardResetParams = Record<string, never>;

class SmartCardResetInvocation extends BaseToolInvocation<
  SmartCardResetParams,
  ToolResult
> {
  constructor(params: SmartCardResetParams) {
    super(params);
  }

  getDescription(): string {
    return 'Reset (power-cycle) the smart card in the active reader';
  }

  async execute(): Promise<ToolResult> {
    const { atr } = await smartcardReset();
    const content = `Card reset. ATR = ${atr || '(unavailable)'}`;
    return { llmContent: content, returnDisplay: content };
  }
}

export class SmartCardResetTool extends BaseDeclarativeTool<
  SmartCardResetParams,
  ToolResult
> {
  static readonly Name = ToolNames.SMARTCARD_RESET;

  constructor() {
    super(
      SmartCardResetTool.Name,
      ToolDisplayNames.SMARTCARD_RESET,
      'Reset (power-cycle) the smart card in the active reader and return ' +
        'the new ATR.',
      Kind.Other,
      {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      false, // isOutputMarkdown
      false, // canUpdateOutput
      false, // shouldDefer
      false, // alwaysLoad
      'smartcard reset atr card',
    );
  }

  protected createInvocation(
    params: SmartCardResetParams,
  ): ToolInvocation<SmartCardResetParams, ToolResult> {
    return new SmartCardResetInvocation(params);
  }
}
