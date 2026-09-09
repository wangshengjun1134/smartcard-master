/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SkillDefinition } from '../skills/types.js';
import type {
  RuntimeToSkillMessage,
  SkillToRuntimeMessage,
} from './ipc-protocol.js';

/**
 * Handle returned by SkillHost.start(). Used to send messages to the skill
 * and stop execution.
 */
export interface SkillExecutionHandle {
  executionId: string;
  /** Send a Runtime→Skill message (e.g. action result, stop signal). */
  send(msg: RuntimeToSkillMessage): void;
  /** Stop execution gracefully. */
  stop(): void;
  /** Promise that resolves when execution finishes. */
  finished(): Promise<SkillToRuntimeMessage>;
}

/**
 * SkillHost: abstracts how a skill runs in a specific language environment.
 *
 * Design doc v2.4 §6: SkillExecutor never checks the language — it delegates
 * to SkillRuntime, which selects the appropriate Host based on Definition.
 */
export interface SkillHost {
  /**
   * Check if this host can run the given skill definition.
   * E.g. ProcessNodeHost returns true for runtime.type === 'node'.
   */
  supports(definition: SkillDefinition): boolean;

  /**
   * Start a skill execution. Returns a handle for communication.
   */
  start(
    definition: SkillDefinition,
    packagePath: string,
  ): Promise<SkillExecutionHandle>;

  /**
   * Release resources held by this host (kill processes, etc.).
   */
  dispose(): Promise<void>;
}
