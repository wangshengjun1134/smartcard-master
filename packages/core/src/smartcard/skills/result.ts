/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SkillAction, SkillResult } from '../runtime/types.js';

/** Build a CONTINUE result carrying the next action. */
export function continueWith(action: SkillAction): SkillResult {
  return { status: 'CONTINUE', nextAction: action };
}

/** Build a SUCCESS result. */
export function success(): SkillResult {
  return { status: 'SUCCESS' };
}

/** Build a FAILED result with an error message. */
export function failed(error: string): SkillResult {
  return { status: 'FAILED', error };
}
