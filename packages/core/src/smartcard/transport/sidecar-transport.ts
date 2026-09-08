/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import type { CardTransport, CardHandle } from './card-transport.js';
import type {
  ApduCommand,
  ApduResponse,
  CardTransportEvent,
  ReaderInfo,
} from './types.js';
import { bytesToHex, hexToBytes } from '../bytes.js';

interface SidecarReader {
  id: string;
  name: string;
}

interface SidecarResponse {
  id: number;
  result?: unknown;
  error?: string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * {@link CardTransport} backed by the `smartcard-sidecar` Rust binary. Spawns
 * one child process per transport and speaks line-delimited JSON-RPC over its
 * stdio. The sidecar owns the PC/SC context and the active card connection.
 */
export class SidecarCardTransport implements CardTransport {
  private child?: ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly handlers = new Map<
    CardTransportEvent,
    Set<(payload: unknown) => void>
  >();

  constructor(private readonly binaryPath: string) {}

  private ensureChild(): ChildProcess {
    if (this.child && !this.child.killed) {
      return this.child;
    }
    const child = spawn(this.binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this.handleLine(line));

    child.on('exit', () => this.handleExit());
    child.stderr?.on('data', () => {
      // Sidecar diagnostics are intentionally not surfaced; a broken child is
      // reported through rejected requests instead.
    });

    return child;
  }

  private handleLine(line: string): void {
    let response: SidecarResponse;
    try {
      response = JSON.parse(line) as SidecarResponse;
    } catch {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    this.pending.delete(response.id);
    if (response.error !== undefined) {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.result);
    }
  }

  private handleExit(): void {
    for (const [, pending] of this.pending) {
      pending.reject(new Error('Smart-card sidecar process exited.'));
    }
    this.pending.clear();
    this.child = undefined;
  }

  private request<T>(method: string, params: object = {}): Promise<T> {
    const child = this.ensureChild();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      if (!child.stdin) {
        reject(new Error('Smart-card sidecar stdin is unavailable.'));
        return;
      }
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  async listReaders(): Promise<ReaderInfo[]> {
    const result = await this.request<{ readers: SidecarReader[] }>(
      'list_readers',
    );
    return result.readers.map((reader) => ({
      id: reader.id,
      name: reader.name,
      status: 'disconnected',
      cardPresent: false,
    }));
  }

  async connect(readerId: string): Promise<CardHandle> {
    const result = await this.request<{ atr: string }>('connect', {
      reader_id: readerId,
    });
    return { readerId, atr: result.atr };
  }

  async disconnect(_readerId: string): Promise<void> {
    await this.request('disconnect');
  }

  async reset(readerId: string): Promise<string> {
    const result = await this.request<{ atr: string }>('reset', {
      reader_id: readerId,
    });
    return result.atr;
  }

  async transmit(readerId: string, apdu: ApduCommand): Promise<ApduResponse> {
    const result = await this.request<{
      data: string;
      sw1: number;
      sw2: number;
      sw: number;
    }>('transmit', {
      reader_id: readerId,
      apdu: {
        cla: apdu.cla,
        ins: apdu.ins,
        p1: apdu.p1,
        p2: apdu.p2,
        ...(apdu.data ? { data: bytesToHex(apdu.data) } : {}),
        ...(apdu.le !== undefined ? { le: apdu.le } : {}),
      },
    });
    return {
      data: hexToBytes(result.data),
      sw1: result.sw1,
      sw2: result.sw2,
      sw: result.sw,
    };
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
    if (!this.child) {
      return;
    }
    try {
      await this.request('close');
    } catch {
      // The child may already be gone; killing below is the backstop.
    }
    this.child.kill();
    this.child = undefined;
  }
}
