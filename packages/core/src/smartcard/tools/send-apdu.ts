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
import type { Config } from '../../config/config.js';
import { requireSmartCardRuntime } from './context.js';
import { bytesToHex, hexToBytes } from '../bytes.js';

export interface SmartCardSendApduParams {
  cla: number;
  ins: number;
  p1: number;
  p2: number;
  data?: string;
  le?: number;
}

class SmartCardSendApduInvocation extends BaseToolInvocation<
  SmartCardSendApduParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: SmartCardSendApduParams,
  ) {
    super(params);
  }

  getDescription(): string {
    return `Send APDU ${this.params.cla.toString(16)} ${this.params.ins.toString(16)} to the card`;
  }

  async execute(): Promise<ToolResult> {
    const runtime = requireSmartCardRuntime(this.config);
    const response = await runtime.sendApdu({
      cla: this.params.cla,
      ins: this.params.ins,
      p1: this.params.p1,
      p2: this.params.p2,
      ...(this.params.data !== undefined
        ? { data: hexToBytes(this.params.data) }
        : {}),
      ...(this.params.le !== undefined ? { le: this.params.le } : {}),
    });

    const sw = response.sw.toString(16).padStart(4, '0').toUpperCase();
    const data = bytesToHex(response.data);
    const content = [`SW = ${sw}`, data ? `Data = ${data}` : '']
      .filter(Boolean)
      .join('\n');
    return { llmContent: content, returnDisplay: content };
  }
}

export class SmartCardSendApduTool extends BaseDeclarativeTool<
  SmartCardSendApduParams,
  ToolResult
> {
  static readonly Name = ToolNames.SMARTCARD_SEND_APDU;

  constructor(private readonly config: Config) {
    super(
      SmartCardSendApduTool.Name,
      ToolDisplayNames.SMARTCARD_SEND_APDU,
      'Send a single APDU command to the smart card in the active reader. ' +
        'Returns the status word (SW) and any response data as hex.',
      Kind.Other,
      {
        type: 'object',
        properties: {
          cla: { type: 'number', description: 'Class byte (0-255)' },
          ins: { type: 'number', description: 'Instruction byte (0-255)' },
          p1: { type: 'number', description: 'Parameter 1 (0-255)' },
          p2: { type: 'number', description: 'Parameter 2 (0-255)' },
          data: {
            type: 'string',
            description: 'Command data as a hex string',
          },
          le: {
            type: 'number',
            description: 'Expected response length (Le)',
          },
        },
        required: ['cla', 'ins', 'p1', 'p2'],
        additionalProperties: false,
      },
      false, // isOutputMarkdown
      false, // canUpdateOutput
      false, // shouldDefer
      false, // alwaysLoad
      'smartcard apdu transmit card command',
    );
  }

  protected createInvocation(
    params: SmartCardSendApduParams,
  ): ToolInvocation<SmartCardSendApduParams, ToolResult> {
    return new SmartCardSendApduInvocation(this.config, params);
  }
}
