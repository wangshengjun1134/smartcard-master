/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ActionResult,
  CardSession,
  SkillEvent,
  SkillOutputSink,
  SkillResult,
} from '../runtime/types.js';

/** Category used to group skills for listing and discovery. */
export type SkillCategory =
  | 'filesystem'
  | 'security'
  | 'crypto'
  | 'authentication'
  | 'custom';

/** Lifecycle status of a single skill execution. */
export type SkillSessionStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

/** Per-execution dynamic state owned by a skill. */
export interface SkillSession {
  sessionId: string;
  skillId: string;
  status: SkillSessionStatus;
}

/** Input supplied to a skill when it is executed. */
export type SkillInput = Record<string, unknown>;

/** Runtime capabilities handed to a skill during execution. */
export interface SkillContext {
  output: SkillOutputSink;
  cardSession: CardSession;
}

/**
 * A smart-card skill owns protocol logic and interacts with the runtime only
 * through {@link SkillResult} / {@link ActionResult}. It never touches the
 * transport directly (design doc v2.3 §2.1).
 */
export interface Skill<S extends SkillSession = SkillSession> {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;

  createSession(context: SkillContext, input: SkillInput): S;
  start(context: SkillContext, session: S): SkillResult;
  handleResult(
    context: SkillContext,
    result: ActionResult,
    session: S,
  ): SkillResult;
}

/** Convenience constructor result for a skill execution. */
export interface SkillExecutionResult<T = unknown> {
  status: SkillSessionStatus;
  data?: T;
  error?: string;
  events: SkillEvent[];
}
