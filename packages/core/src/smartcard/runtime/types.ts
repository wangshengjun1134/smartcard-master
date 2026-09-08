/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ApduCommand, ApduResponse } from '../transport/types.js';

/** Runtime actions a skill may request (design doc v2.3 §9). */
export type ActionType =
  | 'APDU'
  | 'RESET_CARD'
  | 'CONNECT_READER'
  | 'DISCONNECT_READER'
  | 'WAIT';

/** Common fields shared by every skill action. */
interface ActionBase {
  actionId: string;
  name?: string;
  description?: string;
}

/** APDU action carrying a single command to transmit. */
export interface ApduAction extends ActionBase {
  type: 'APDU';
  apdu: ApduCommand;
  sensitive?: boolean;
}

/** Reset (power-cycle) the card in the active reader. */
export interface ResetCardAction extends ActionBase {
  type: 'RESET_CARD';
}

/** Connect to a specific reader. */
export interface ConnectReaderAction extends ActionBase {
  type: 'CONNECT_READER';
  readerId: string;
}

/** Disconnect from a reader. */
export interface DisconnectReaderAction extends ActionBase {
  type: 'DISCONNECT_READER';
  readerId?: string;
}

/** Pause execution for a fixed number of milliseconds. */
export interface WaitAction extends ActionBase {
  type: 'WAIT';
  milliseconds: number;
}

/** A request from a skill for the runtime to perform some work. */
export type SkillAction =
  | ApduAction
  | ResetCardAction
  | ConnectReaderAction
  | DisconnectReaderAction
  | WaitAction;

/** The fact of what the runtime actually did for an action. */
export interface ActionResult {
  actionId: string;
  actionType: ActionType;
  success: boolean;
  error?: string;
}

/** Result of an APDU action. */
export interface ApduActionResult extends ActionResult {
  actionType: 'APDU';
  response: ApduResponse;
}

/** Result of a reset action, carrying the new ATR. */
export interface ResetCardResult extends ActionResult {
  actionType: 'RESET_CARD';
  atr: string;
}

/** Result of a connect action. */
export interface ConnectReaderResult extends ActionResult {
  actionType: 'CONNECT_READER';
  atr: string;
}

/** Result of a disconnect action. */
export interface DisconnectReaderResult extends ActionResult {
  actionType: 'DISCONNECT_READER';
}

/** Control-flow status returned by a skill after each invocation. */
export type SkillStatus = 'CONTINUE' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

/** A skill's decision about what the runtime should do next. */
export interface SkillResult {
  status: SkillStatus;
  nextAction?: SkillAction;
  error?: string;
}

/** Sink for a skill's process output (kept separate from control flow). */
export interface SkillOutputSink {
  text(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  data(data: unknown): void;
}

/** A single process-output event emitted during skill execution. */
export interface SkillEvent {
  level: 'TEXT' | 'INFO' | 'WARN' | 'ERROR' | 'DATA';
  message: string;
  data?: unknown;
}

/** Read-only snapshot of the active card session, exposed to skills. */
export interface CardSession {
  readerId: string | null;
  atr: string | null;
  connected: boolean;
}
