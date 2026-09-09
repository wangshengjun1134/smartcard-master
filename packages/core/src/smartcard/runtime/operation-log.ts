/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/** A single APDU exchange (request hex + response status word/data). */
export interface ApduOperation {
  type: 'apdu';
  /** Full command bytes as an uppercase hex string (header + Lc + data + Le). */
  request: string;
  /** Response data as an uppercase hex string (empty when none). */
  response: string;
  /** Combined status word, (sw1 << 8) | sw2. */
  sw: number;
}

/** A reader connection was established. */
export interface ConnectOperation {
  type: 'connect';
  readerId: string;
  atr: string;
}

/** The active reader was disconnected. */
export interface DisconnectOperation {
  type: 'disconnect';
}

/** The card in the active reader was reset (power-cycled). */
export interface ResetOperation {
  type: 'reset';
  atr: string;
}

/** Everything the console renders as smart-card activity. */
export type SmartCardOperation =
  | ApduOperation
  | ConnectOperation
  | DisconnectOperation
  | ResetOperation;

const DEFAULT_CAPACITY = 500;

/**
 * Bounded, append-only in-memory log of smart-card operations. The daemon owns
 * one instance per runtime; the console replays it on connect and receives live
 * pushes for new entries.
 */
export class OperationLog {
  private readonly entries: SmartCardOperation[] = [];
  private readonly listeners = new Set<(op: SmartCardOperation) => void>();
  private readonly capacity: number;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.capacity = capacity;
  }

  append(op: SmartCardOperation): void {
    this.entries.push(op);
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
    for (const listener of this.listeners) {
      listener(op);
    }
  }

  snapshot(): SmartCardOperation[] {
    return [...this.entries];
  }

  subscribe(listener: (op: SmartCardOperation) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
