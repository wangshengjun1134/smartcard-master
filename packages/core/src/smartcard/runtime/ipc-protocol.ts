/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cross-language IPC protocol types for Skill ↔ Runtime communication.
 *
 * Design doc v2.4 §7: the core contract is shared execution semantics,
 * not shared Java classes. Every language implements this JSON protocol.
 */

// ── Direction: Skill → Runtime ───────────────────────────────────────

/** Skill requests the runtime to perform an action. */
export interface SkillActionMessage {
  type: 'skill_action';
  executionId: string;
  action: {
    id: string;
    type: ActionType;
    name?: string;
    description?: string;
    apdu?: ApduCommandData;
    sensitive?: boolean;
    milliseconds?: number;
    readerId?: string;
  };
}

export type ActionType =
  | 'APDU'
  | 'RESET_CARD'
  | 'CONNECT_READER'
  | 'DISCONNECT_READER'
  | 'WAIT';

export interface ApduCommandData {
  cla: number;
  ins: number;
  p1: number;
  p2: number;
  data?: number[];
  le?: number;
}

/** Skill signals execution is complete. */
export interface SkillFinishMessage {
  type: 'execution_finished';
  executionId: string;
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  error?: string;
  data?: unknown;
}

/** Skill emits a process-output event. */
export interface SkillOutputMessage {
  type: 'output';
  executionId: string;
  level: 'TEXT' | 'INFO' | 'WARN' | 'ERROR' | 'DATA';
  message: string;
  data?: unknown;
}

/** Union of all messages a Skill can send to the Runtime. */
export type SkillToRuntimeMessage =
  | SkillActionMessage
  | SkillFinishMessage
  | SkillOutputMessage;

// ── Direction: Runtime → Skill ───────────────────────────────────────

/** Runtime delivers the initial input to start execution. */
export interface RuntimeStartMessage {
  type: 'start';
  executionId: string;
  skillId: string;
  input: Record<string, unknown>;
  cardSession: {
    readerId: string | null;
    atr: string | null;
    connected: boolean;
  };
}

/** Runtime delivers an action result back to the skill. */
export interface RuntimeActionResultMessage {
  type: 'action_result';
  executionId: string;
  actionId: string;
  actionType: ActionType;
  success: boolean;
  error?: string;
  // Action-specific fields
  atr?: string;
  response?: ApduResponseData;
}

export interface ApduResponseData {
  sw: number;
  data: number[];
}

/** Runtime signals the skill to stop (timeout, cancellation, etc.). */
export interface RuntimeStopMessage {
  type: 'stop';
  executionId: string;
  reason?: string;
}

/** Union of all messages the Runtime can send to a Skill. */
export type RuntimeToSkillMessage =
  | RuntimeStartMessage
  | RuntimeActionResultMessage
  | RuntimeStopMessage;

// ── Helpers ──────────────────────────────────────────────────────────

/** Parse a line of JSON from stdin. Throws on invalid JSON. */
export function parseMessage(line: string): SkillToRuntimeMessage {
  return JSON.parse(line) as SkillToRuntimeMessage;
}

/** Serialize a Runtime→Skill message to a JSON line for stdout. */
export function serializeMessage(msg: RuntimeToSkillMessage): string {
  return JSON.stringify(msg);
}
