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
  SkillDefinition,
  SkillExecutionResult,
  SkillInput,
} from '../skills/types.js';
import { apduToBytes, bytesToHex } from '../bytes.js';
import { SkillRegistry } from '../skills/registry.js';
import { SkillPackageLoader } from '../skills/package-loader.js';
import { ActionExecutor } from './action-executor.js';
import { SkillExecutor } from './skill-executor.js';
import { SkillRuntime } from './skill-runtime.js';
import { OperationLog, type SmartCardOperation } from './operation-log.js';
import type { CardSession, SkillAction } from './types.js';

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
  private readonly skillRuntime: SkillRuntime;
  private readonly packageLoader: SkillPackageLoader;
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
    this.skillRuntime = new SkillRuntime();
    this.packageLoader = new SkillPackageLoader();
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

  /** Enable or disable a skill. Returns true if the skill was found. */
  setSkillEnabled(skillId: string, enabled: boolean): boolean {
    return this.registry.setEnabled(skillId, enabled);
  }

  /**
   * Load skill packages from a directory and register them.
   * Design doc v2.4 §9: discovers skill.json manifests and validates them.
   */
  loadSkillsFromDirectory(dir: string): SkillDefinition[] {
    const definitions = this.packageLoader.scanDirectory(dir);
    for (const def of definitions) {
      // For node skills, we still need the in-process Skill implementation
      // For python skills, they run out-of-process via SkillRuntime
      this.registry.register(createSkillAdapter(def));
    }
    return definitions;
  }

  /**
   * Execute a skill via the multi-language runtime.
   * For node/python skills that run in separate processes.
   */
  async executeSkillViaRuntime(
    skillId: string,
    packagePath: string,
    input: SkillInput,
  ): Promise<SkillExecutionResult> {
    const def = this.registry.get(skillId);
    if (!def) {
      return {
        status: 'FAILED',
        error: `Skill "${skillId}" is not registered.`,
        events: [],
      };
    }

    // Get the skill definition from the registry
    const skillDef = (def as unknown as { definition?: SkillDefinition })
      .definition;
    if (!skillDef) {
      return {
        status: 'FAILED',
        error: `Skill "${skillId}" does not have a package definition.`,
        events: [],
      };
    }

    try {
      const handle = await this.skillRuntime.start(skillDef, packagePath);

      // Subscribe to skill_action messages and execute them through ActionExecutor
      handle.onAction(async (actionMsg) => {
        try {
          // Map IPC action (uses 'id') to SkillAction (uses 'actionId')
          const action = actionMsg.action;
          const skillAction: SkillAction = {
            actionId: action.id,
            type: action.type as SkillAction['type'],
            name: action.name,
            description: action.description,
            ...(action.apdu && { apdu: action.apdu }),
            ...(action.sensitive !== undefined && {
              sensitive: action.sensitive,
            }),
            ...(action.milliseconds !== undefined && {
              milliseconds: action.milliseconds,
            }),
            ...(action.readerId && { readerId: action.readerId }),
          } as SkillAction;

          const actionResult = await this.actionExecutor.execute(skillAction);
          // Send result back to skill
          handle.send({
            type: 'action_result',
            executionId: handle.executionId,
            actionId: actionResult.actionId,
            actionType: actionResult.actionType,
            success: actionResult.success,
            error: actionResult.error,
            // Action-specific fields
            atr: (actionResult as unknown as Record<string, unknown>)['atr'] as
              | string
              | undefined,
            response: (actionResult as unknown as Record<string, unknown>)[
              'response'
            ] as { sw: number; data: number[] } | undefined,
          });
        } catch (err) {
          // Send error result back to skill
          handle.send({
            type: 'action_result',
            executionId: handle.executionId,
            actionId: actionMsg.action.id,
            actionType: actionMsg.action.type,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });

      // Send start message
      handle.send({
        type: 'start',
        executionId: handle.executionId,
        skillId: skillDef.skillId,
        input,
        cardSession: this.getCardSession(),
      });

      // Wait for completion
      const result = await handle.finished();

      if (result.type === 'execution_finished') {
        return {
          status: result.status,
          error: result.error,
          events: [], // Output events would be collected via IPC in a full implementation
        };
      }

      return {
        status: 'FAILED',
        error: 'Unexpected message type from skill',
        events: [],
      };
    } catch (err) {
      return {
        status: 'FAILED',
        error: err instanceof Error ? err.message : String(err),
        events: [],
      };
    }
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
    await this.skillRuntime.dispose();
    this.readerId = null;
    this.atr = null;
  }
}

/**
 * Create a Skill adapter wrapper that holds the SkillDefinition.
 * This allows the runtime to access the definition for multi-language execution.
 */
function createSkillAdapter(def: SkillDefinition): Skill {
  return {
    skillId: def.skillId,
    name: def.name,
    description: def.description,
    category: def.category,
    enabled: true,
    definition: def,
    createSession() {
      throw new Error(
        'Out-of-process skills do not support in-process sessions',
      );
    },
    start() {
      throw new Error(
        'Out-of-process skills must be executed via executeSkillViaRuntime',
      );
    },
    handleResult() {
      throw new Error(
        'Out-of-process skills do not support in-process handling',
      );
    },
  } as unknown as Skill;
}
