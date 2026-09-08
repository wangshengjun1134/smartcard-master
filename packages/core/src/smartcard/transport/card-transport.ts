/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ApduCommand,
  ApduResponse,
  CardTransportEvent,
  ReaderInfo,
} from './types.js';

/** A handle for a card currently connected on a reader. */
export interface CardHandle {
  readerId: string;
  atr: string;
}

/**
 * Abstraction over the underlying PC/SC access layer. This is the only layer
 * that may depend on a native smart-card binding; everything above it operates
 * against this interface so the transport can be swapped (mock, pcsclite,
 * command-line IPC, ...) without touching runtime or skills.
 */
export interface CardTransport {
  /** List all readers visible to the PC/SC stack. */
  listReaders(): Promise<ReaderInfo[]>;

  /** Connect to the card present in the given reader, returning its ATR. */
  connect(readerId: string): Promise<CardHandle>;

  /** Disconnect from the given reader, if connected. */
  disconnect(readerId: string): Promise<void>;

  /** Reset (power-cycle) the card in the given reader, returning the new ATR. */
  reset(readerId: string): Promise<string>;

  /** Transmit a single APDU command to the card in the given reader. */
  transmit(readerId: string, apdu: ApduCommand): Promise<ApduResponse>;

  /** Subscribe to a transport event. Returns an unsubscribe function. */
  on(
    event: CardTransportEvent,
    handler: (payload: unknown) => void,
  ): () => void;

  /** Release all native resources held by this transport. */
  close(): Promise<void>;
}
