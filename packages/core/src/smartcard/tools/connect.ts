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
import { smartcardConnect, smartcardListReaders } from '../daemon-client.js';

export interface SmartCardConnectParams {
  readerId?: string;
}

class SmartCardConnectInvocation extends BaseToolInvocation<
  SmartCardConnectParams,
  ToolResult
> {
  constructor(params: SmartCardConnectParams) {
    super(params);
  }

  getDescription(): string {
    return this.params.readerId
      ? `Connect to smart card reader "${this.params.readerId}"`
      : 'List available smart card readers';
  }

  async execute(): Promise<ToolResult> {
    if (!this.params.readerId) {
      const { readers } = await smartcardListReaders();
      const lines = readers.map((reader) =>
        [
          reader.id,
          reader.status,
          reader.cardPresent ? 'card-present' : 'no-card',
          reader.atr ? `ATR=${reader.atr}` : '',
        ]
          .filter(Boolean)
          .join(' '),
      );
      const content = lines.length
        ? `Available readers:\n${lines.join('\n')}`
        : 'No smart card readers detected.';
      return { llmContent: content, returnDisplay: content };
    }

    const { atr } = await smartcardConnect(this.params.readerId);
    const content = `Connected to reader "${this.params.readerId}". ATR = ${atr || '(unavailable)'}`;
    return { llmContent: content, returnDisplay: content };
  }
}

export class SmartCardConnectTool extends BaseDeclarativeTool<
  SmartCardConnectParams,
  ToolResult
> {
  static readonly Name = ToolNames.SMARTCARD_CONNECT;

  constructor() {
    super(
      SmartCardConnectTool.Name,
      ToolDisplayNames.SMARTCARD_CONNECT,
      'Connect to a smart card reader. Omit readerId to list the readers ' +
        'currently visible to the PC/SC stack.',
      Kind.Other,
      {
        type: 'object',
        properties: {
          readerId: {
            type: 'string',
            description:
              'Reader ID to connect. Omit to list available readers instead.',
          },
        },
        additionalProperties: false,
      },
      false, // isOutputMarkdown
      false, // canUpdateOutput
      false, // shouldDefer
      false, // alwaysLoad
      'smartcard reader connect card apdu',
    );
  }

  protected createInvocation(
    params: SmartCardConnectParams,
  ): ToolInvocation<SmartCardConnectParams, ToolResult> {
    return new SmartCardConnectInvocation(params);
  }
}
