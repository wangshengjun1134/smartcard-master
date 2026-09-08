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
import { SkillRegistry } from '../skills/registry.js';
import { ActionExecutor } from './action-executor.js';
import { SkillExecutor } from './skill-executor.js';
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
  private readerId: string | null = null;
  private atr: string | null = null;

  constructor(transport: CardTransport, registry?: SkillRegistry) {
    this.transport = transport;
    this.registry = registry ?? new SkillRegistry();
    this.actionExecutor = new ActionExecutor(transport, () => this.readerId);
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
    return handle.atr;
  }

  async disconnect(): Promise<void> {
    if (this.readerId) {
      await this.transport.disconnect(this.readerId);
    }
    this.readerId = null;
    this.atr = null;
  }

  async reset(): Promise<string> {
    const readerId = this.readerId;
    if (!readerId) {
      throw new Error('No active reader. Connect a reader before resetting.');
    }
    const atr = await this.transport.reset(readerId);
    this.atr = atr;
    return atr;
  }

  async sendApdu(apdu: ApduCommand): Promise<ApduResponse> {
    const readerId = this.readerId;
    if (!readerId) {
      throw new Error(
        'No active reader. Connect a reader before sending APDU.',
      );
    }
    return this.transport.transmit(readerId, apdu);
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
