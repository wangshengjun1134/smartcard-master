/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/** Connection status of a smart card reader. */
export type ReaderStatus = 'connected' | 'disconnected' | 'busy' | 'error';

/** A smart card reader known to the underlying PC/SC stack. */
export interface ReaderInfo {
  /** Stable reader identifier (PC/SC reader name). */
  id: string;
  /** Human-readable reader name. */
  name: string;
  /** Connection status of this reader in the current process. */
  status: ReaderStatus;
  /** Whether a card is currently present in the reader. */
  cardPresent: boolean;
  /** Answer To Reset bytes as hex, when a card is present and connected. */
  atr?: string;
}

/** A single APDU command to transmit to the card. */
export interface ApduCommand {
  /** Class byte. */
  cla: number;
  /** Instruction byte. */
  ins: number;
  /** Parameter 1. */
  p1: number;
  /** Parameter 2. */
  p2: number;
  /** Command data, when the command carries any. */
  data?: Uint8Array;
  /** Expected response length (Le). */
  le?: number;
}

/** The response to a single APDU command. */
export interface ApduResponse {
  /** Response data (excluding the two status-word bytes). */
  data: Uint8Array;
  /** Status word 1. */
  sw1: number;
  /** Status word 2. */
  sw2: number;
  /** Combined status word, (sw1 << 8) | sw2. */
  sw: number;
}

/** Events emitted by a {@link CardTransport}. */
export type CardTransportEvent =
  | 'reader-attached'
  | 'reader-removed'
  | 'card-inserted'
  | 'card-removed';

/** Payload for a reader-attached event. */
export interface ReaderAttachedEvent {
  reader: ReaderInfo;
}

/** Payload for a reader-removed event. */
export interface ReaderRemovedEvent {
  readerId: string;
}
