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

export type SmartCardDisconnectParams = Record<string, never>;

class SmartCardDisconnectInvocation extends BaseToolInvocation<
  SmartCardDisconnectParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    params: SmartCardDisconnectParams,
  ) {
    super(params);
  }

  getDescription(): string {
    return 'Disconnect from the active smart card reader';
  }

  async execute(): Promise<ToolResult> {
    const runtime = requireSmartCardRuntime(this.config);
    await runtime.disconnect();
    const content = 'Disconnected from the smart card reader.';
    return { llmContent: content, returnDisplay: content };
  }
}

export class SmartCardDisconnectTool extends BaseDeclarativeTool<
  SmartCardDisconnectParams,
  ToolResult
> {
  static readonly Name = ToolNames.SMARTCARD_DISCONNECT;

  constructor(private readonly config: Config) {
    super(
      SmartCardDisconnectTool.Name,
      ToolDisplayNames.SMARTCARD_DISCONNECT,
      'Disconnect from the currently active smart card reader.',
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
      'smartcard reader disconnect close',
    );
  }

  protected createInvocation(
    params: SmartCardDisconnectParams,
  ): ToolInvocation<SmartCardDisconnectParams, ToolResult> {
    return new SmartCardDisconnectInvocation(this.config, params);
  }
}
