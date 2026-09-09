/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CardTransport, CardHandle } from './card-transport.js';
import type {
  ApduCommand,
  ApduResponse,
  CardTransportEvent,
  ReaderInfo,
} from './types.js';

const MOCK_ATR = '3B8F8001804F0CA000000306030001000000006A';
const MOCK_READER_ID = 'mock-reader-0';

/**
 * In-memory transport used when no real PC/SC stack is available (CLI mode,
 * tests, front-end development). Exposes a single always-present reader with
 * a card that answers SELECT with 9000 and everything else with 6D00.
 */
export class MockCardTransport implements CardTransport {
  private readonly handlers = new Map<
    CardTransportEvent,
    Set<(payload: unknown) => void>
  >();
  private connectedReaders = new Set<string>();

  async listReaders(): Promise<ReaderInfo[]> {
    return [
      {
        id: MOCK_READER_ID,
        name: 'Mock Reader',
        status: this.connectedReaders.has(MOCK_READER_ID)
          ? 'connected'
          : 'disconnected',
        cardPresent: true,
        atr: MOCK_ATR,
      },
    ];
  }

  async connect(readerId: string): Promise<CardHandle> {
    this.connectedReaders.add(readerId);
    return { readerId, atr: MOCK_ATR };
  }

  async disconnect(readerId: string): Promise<void> {
    this.connectedReaders.delete(readerId);
  }

  async reset(readerId: string): Promise<string> {
    this.connectedReaders.add(readerId);
    return MOCK_ATR;
  }

  async transmit(readerId: string, apdu: ApduCommand): Promise<ApduResponse> {
    if (!this.connectedReaders.has(readerId)) {
      throw new Error(`Reader ${readerId} is not connected.`);
    }
    // SELECT (00 A4) always succeeds; anything else is unsupported.
    if (apdu.cla === 0x00 && apdu.ins === 0xa4) {
      return { data: new Uint8Array(0), sw1: 0x90, sw2: 0x00, sw: 0x9000 };
    }
    return { data: new Uint8Array(0), sw1: 0x6d, sw2: 0x00, sw: 0x6d00 };
  }

  on(
    event: CardTransportEvent,
    handler: (payload: unknown) => void,
  ): () => void {
    let handlers = this.handlers.get(event);
    if (!handlers) {
      handlers = new Set();
      this.handlers.set(event, handlers);
    }
    handlers.add(handler);
    return () => handlers?.delete(handler);
  }

  async close(): Promise<void> {
    this.connectedReaders.clear();
    this.handlers.clear();
  }
}
