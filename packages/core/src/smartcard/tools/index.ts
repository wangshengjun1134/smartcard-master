/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolRegistry } from '../../tools/tool-registry.js';
import { SmartCardConnectTool } from './connect.js';
import { SmartCardDisconnectTool } from './disconnect.js';
import { SmartCardSendApduTool } from './send-apdu.js';
import { SmartCardResetTool } from './reset.js';
import { SmartCardExecuteSkillTool } from './execute-skill.js';

export type { SmartCardConnectParams } from './connect.js';
export type { SmartCardSendApduParams } from './send-apdu.js';
export type { SmartCardExecuteSkillParams } from './execute-skill.js';
export { SmartCardConnectTool } from './connect.js';
export { SmartCardDisconnectTool } from './disconnect.js';
export { SmartCardSendApduTool } from './send-apdu.js';
export { SmartCardResetTool } from './reset.js';
export { SmartCardExecuteSkillTool } from './execute-skill.js';

/** Register all smart-card tools eagerly against the given registry. */
export function registerSmartCardTools(registry: ToolRegistry): void {
  registry.registerTool(new SmartCardConnectTool());
  registry.registerTool(new SmartCardDisconnectTool());
  registry.registerTool(new SmartCardSendApduTool());
  registry.registerTool(new SmartCardResetTool());
  registry.registerTool(new SmartCardExecuteSkillTool());
}
