/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CardTransport } from '../transport/card-transport.js';
import type {
  ApduCommand,
  ApduResponse,
  ReaderInfo,
} from '../transport/types.js';
import type {
  Skill,
  SkillExecutionResult,
  SkillInput,
} from '../skills/types.js';
import { apduToBytes, bytesToHex } from '../bytes.js';
import { SkillRegistry } from '../skills/registry.js';
import { ActionExecutor } from './action-executor.js';
import { SkillExecutor } from './skill-executor.js';
import { OperationLog, type SmartCardOperation } from './operation-log.js';
import type { CardSession } from './types.js';

/**
 * Process-level facade for smart-card operations. Owns the transport, the
 * active-reader selection, the action/skill executors, and the skill registry.
 * A single instance is shared by agent tools and daemon HTTP routes.
 */
export class SmartCardRuntime {
  private readonly transport: CardTransport;
  private readonly registry: SkillRegistry;
  private readonly actionExecutor: ActionExecutor;
  private readonly skillExecutor: SkillExecutor;
  private readonly operationLog = new OperationLog();
  private readerId: string | null = null;
  private atr: string | null = null;

  constructor(transport: CardTransport, registry?: SkillRegistry) {
    this.transport = transport;
    this.registry = registry ?? new SkillRegistry();
    this.actionExecutor = new ActionExecutor(
      transport,
      () => this.readerId,
      (op) => this.operationLog.append(op),
    );
    this.skillExecutor = new SkillExecutor(this.actionExecutor, () =>
      this.getCardSession(),
    );
  }

  getCardSession(): CardSession {
    return {
      readerId: this.readerId,
      atr: this.atr,
      connected: this.readerId !== null,
    };
  }

  async listReaders(): Promise<ReaderInfo[]> {
    return this.transport.listReaders();
  }

  async connect(readerId: string): Promise<string> {
    const handle = await this.transport.connect(readerId);
    this.readerId = readerId;
    this.atr = handle.atr;
    this.operationLog.append({ type: 'connect', readerId, atr: handle.atr });
    return handle.atr;
  }

  async disconnect(): Promise<void> {
    if (this.readerId) {
      await this.transport.disconnect(this.readerId);
    }
    this.readerId = null;
    this.atr = null;
    this.operationLog.append({ type: 'disconnect' });
  }

  async reset(): Promise<string> {
    const readerId = this.readerId;
    if (!readerId) {
      throw new Error('No active reader. Connect a reader before resetting.');
    }
    const atr = await this.transport.reset(readerId);
    this.atr = atr;
    this.operationLog.append({ type: 'reset', atr });
    return atr;
  }

  async sendApdu(apdu: ApduCommand): Promise<ApduResponse> {
    const readerId = this.readerId;
    if (!readerId) {
      throw new Error(
        'No active reader. Connect a reader before sending APDU.',
      );
    }
    const response = await this.transport.transmit(readerId, apdu);
    this.operationLog.append({
      type: 'apdu',
      request: bytesToHex(apduToBytes(apdu)),
      response: bytesToHex(response.data),
      sw: response.sw,
    });
    return response;
  }

  /** Snapshot of the operations recorded so far (replay on SSE connect). */
  getOperations(): SmartCardOperation[] {
    return this.operationLog.snapshot();
  }

  /** Subscribe to live operations. Returns an unsubscribe function. */
  onOperation(listener: (op: SmartCardOperation) => void): () => void {
    return this.operationLog.subscribe(listener);
  }

  listSkills(): Skill[] {
    return this.registry.list();
  }

  getSkill(skillId: string): Skill | undefined {
    return this.registry.get(skillId);
  }

  registerSkill(skill: Skill): void {
    this.registry.register(skill);
  }

  async executeSkill(
    skillId: string,
    input: SkillInput,
  ): Promise<SkillExecutionResult> {
    const skill = this.registry.get(skillId);
    if (!skill) {
      return {
        status: 'FAILED',
        error: `Skill "${skillId}" is not registered.`,
        events: [],
      };
    }
    return this.skillExecutor.execute(skill, input);
  }

  async close(): Promise<void> {
    await this.transport.close();
    this.readerId = null;
    this.atr = null;
  }
}
