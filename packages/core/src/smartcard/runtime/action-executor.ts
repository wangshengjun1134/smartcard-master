/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CardTransport } from '../transport/card-transport.js';
import { apduToBytes, bytesToHex } from '../bytes.js';
import type {
  ApduAction,
  ApduActionResult,
  ActionResult,
  ConnectReaderAction,
  ConnectReaderResult,
  DisconnectReaderAction,
  DisconnectReaderResult,
  ResetCardAction,
  ResetCardResult,
  SkillAction,
  WaitAction,
} from './types.js';
import type { SmartCardOperation } from './operation-log.js';

/** Resolves the reader an action should target. */
export interface ActiveReaderProvider {
  (): string | null;
}

/** Receives operations performed on a skill's behalf (APDU, connect, ...). */
export type OperationListener = (op: SmartCardOperation) => void;

function successResult(
  action: SkillAction,
  fields: Partial<ActionResult>,
): ActionResult {
  return {
    actionId: action.actionId,
    actionType: action.type,
    success: true,
    ...fields,
  };
}

function failedResult(action: SkillAction, error: unknown): ActionResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    actionId: action.actionId,
    actionType: action.type,
    success: false,
    error: message,
  };
}

/**
 * Executes a {@link SkillAction} against the underlying transport and returns
 * the resulting {@link ActionResult}. This is the only runtime component that
 * touches the transport on a skill's behalf.
 */
export class ActionExecutor {
  constructor(
    private readonly transport: CardTransport,
    private readonly getActiveReaderId: ActiveReaderProvider,
    private readonly onOperation?: OperationListener,
  ) {}

  private requireReader(action: SkillAction): string {
    const readerId = this.getActiveReaderId();
    if (!readerId) {
      throw new Error(`No active reader for action "${action.actionId}".`);
    }
    return readerId;
  }

  async execute(action: SkillAction): Promise<ActionResult> {
    try {
      switch (action.type) {
        case 'APDU':
          return this.executeApdu(action);
        case 'RESET_CARD':
          return this.executeReset(action);
        case 'CONNECT_READER':
          return this.executeConnect(action);
        case 'DISCONNECT_READER':
          return this.executeDisconnect(action);
        case 'WAIT':
          return this.executeWait(action);
        default:
          return failedResult(action, `Unsupported action type.`);
      }
    } catch (error) {
      return failedResult(action, error);
    }
  }

  private async executeApdu(action: ApduAction): Promise<ApduActionResult> {
    const readerId = this.requireReader(action);
    const response = await this.transport.transmit(readerId, action.apdu);
    this.onOperation?.({
      type: 'apdu',
      request: bytesToHex(apduToBytes(action.apdu)),
      response: bytesToHex(response.data),
      sw: response.sw,
    });
    return {
      actionId: action.actionId,
      actionType: 'APDU',
      success: true,
      response,
    } satisfies ApduActionResult;
  }

  private async executeReset(
    action: ResetCardAction,
  ): Promise<ResetCardResult> {
    const readerId = this.requireReader(action);
    const atr = await this.transport.reset(readerId);
    this.onOperation?.({ type: 'reset', atr });
    return {
      actionId: action.actionId,
      actionType: 'RESET_CARD',
      success: true,
      atr,
    } satisfies ResetCardResult;
  }

  private async executeConnect(
    action: ConnectReaderAction,
  ): Promise<ConnectReaderResult> {
    const handle = await this.transport.connect(action.readerId);
    this.onOperation?.({
      type: 'connect',
      readerId: action.readerId,
      atr: handle.atr,
    });
    return {
      actionId: action.actionId,
      actionType: 'CONNECT_READER',
      success: true,
      atr: handle.atr,
    } satisfies ConnectReaderResult;
  }

  private async executeDisconnect(
    action: DisconnectReaderAction,
  ): Promise<DisconnectReaderResult> {
    const readerId = action.readerId ?? this.requireReader(action);
    await this.transport.disconnect(readerId);
    this.onOperation?.({ type: 'disconnect' });
    return {
      actionId: action.actionId,
      actionType: 'DISCONNECT_READER',
      success: true,
    } satisfies DisconnectReaderResult;
  }

  private async executeWait(action: WaitAction): Promise<ActionResult> {
    await new Promise((resolve) => setTimeout(resolve, action.milliseconds));
    return successResult(action, { actionType: action.type });
  }
}
