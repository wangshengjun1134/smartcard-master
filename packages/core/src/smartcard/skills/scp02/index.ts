/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ApduResponse } from '../../transport/types.js';
import type {
  ActionResult,
  ApduActionResult,
  ResetCardResult,
  SkillResult,
} from '../../runtime/types.js';
import type { Skill, SkillContext, SkillInput } from '../types.js';
import { continueWith, failed, success } from '../result.js';
import { bytesToHex, hexToBytes } from '../../bytes.js';
import {
  INITIALIZE_UPDATE_RESPONSE_LENGTH,
  INS_EXTERNAL_AUTHENTICATE,
  INS_INITIALIZE_UPDATE,
  SCP02_CLA,
  SELECT_CLA,
  SELECT_INS,
  SELECT_P1_BY_AID,
} from './constants.js';
import {
  computeCardCryptogram,
  computeHostCryptogram,
  deriveSessionKeys,
} from './crypto.js';
import { Scp02Session, type Scp02Input } from './session.js';
import { Scp02State } from './state.js';

const SW_OK = 0x9000;

/**
 * SCP02 secure-channel establishment (GlobalPlatform). Owns the full protocol
 * state machine: RESET -> SELECT -> INITIALIZE UPDATE -> EXTERNAL AUTHENTICATE.
 */
export class Scp02Skill implements Skill<Scp02Session> {
  readonly skillId = 'scp02.open';
  readonly name = 'SCP02 Open Secure Channel';
  readonly description =
    'Establish a GlobalPlatform SCP02 secure channel with the card.';
  readonly category = 'security' as const;

  createSession(_context: SkillContext, input: SkillInput): Scp02Session {
    return new Scp02Session(input as unknown as Scp02Input);
  }

  start(_context: SkillContext, session: Scp02Session): SkillResult {
    session.state = Scp02State.WAIT_RESET;
    return continueWith({
      actionId: 'scp02.reset',
      type: 'RESET_CARD',
      name: 'Reset Card',
    });
  }

  handleResult(
    context: SkillContext,
    result: ActionResult,
    session: Scp02Session,
  ): SkillResult {
    switch (session.state) {
      case Scp02State.WAIT_RESET:
        return this.handleReset(context, result, session);
      case Scp02State.WAIT_SELECT:
        return this.handleSelect(context, result, session);
      case Scp02State.WAIT_INITIALIZE_UPDATE:
        return this.handleInitializeUpdate(context, result, session);
      case Scp02State.WAIT_EXTERNAL_AUTHENTICATE:
        return this.handleExternalAuthenticate(context, result, session);
      default:
        session.state = Scp02State.FAILED;
        return failed(`Unexpected SCP02 state: ${session.state}`);
    }
  }

  private handleReset(
    context: SkillContext,
    result: ActionResult,
    session: Scp02Session,
  ): SkillResult {
    if (result.actionType !== 'RESET_CARD') {
      return this.fail(session, `Expected reset, got ${result.actionType}`);
    }
    const reset = result as ResetCardResult;
    session.atr = reset.atr;
    context.output.info(`Card reset. ATR = ${reset.atr}`);

    if (session.aid) {
      session.state = Scp02State.WAIT_SELECT;
      return continueWith({
        actionId: 'scp02.select',
        type: 'APDU',
        name: 'Select Security Domain',
        apdu: {
          cla: SELECT_CLA,
          ins: SELECT_INS,
          p1: SELECT_P1_BY_AID,
          p2: 0x00,
          data: hexToBytes(session.aid),
        },
      });
    }
    return this.initializeUpdate(context, session);
  }

  private handleSelect(
    context: SkillContext,
    result: ActionResult,
    session: Scp02Session,
  ): SkillResult {
    const response = this.requireApduResponse(result, session);
    if (!response) {
      return failed('SELECT did not return an APDU response.');
    }
    if (response.sw !== SW_OK) {
      return this.fail(session, `SELECT failed with SW=${swHex(response)}`);
    }
    context.output.info(`Security domain selected (AID=${session.aid})`);
    return this.initializeUpdate(context, session);
  }

  private initializeUpdate(
    context: SkillContext,
    session: Scp02Session,
  ): SkillResult {
    session.state = Scp02State.WAIT_INITIALIZE_UPDATE;
    context.output.info('Sending INITIALIZE UPDATE');
    return continueWith({
      actionId: 'scp02.initialize-update',
      type: 'APDU',
      name: 'Initialize Update',
      apdu: {
        cla: SCP02_CLA,
        ins: INS_INITIALIZE_UPDATE,
        p1: 0x00,
        p2: session.keyVersion,
        data: session.hostChallenge,
        le: 0x00,
      },
      sensitive: false,
    });
  }

  private handleInitializeUpdate(
    context: SkillContext,
    result: ActionResult,
    session: Scp02Session,
  ): SkillResult {
    const response = this.requireApduResponse(result, session);
    if (!response) {
      return failed('INITIALIZE UPDATE did not return an APDU response.');
    }
    if (response.sw !== SW_OK) {
      return this.fail(
        session,
        `INITIALIZE UPDATE failed with SW=${swHex(response)}`,
      );
    }
    if (response.data.length < INITIALIZE_UPDATE_RESPONSE_LENGTH) {
      return this.fail(
        session,
        `INITIALIZE UPDATE response too short (${response.data.length} bytes).`,
      );
    }

    // Parse: key diversification data (10) | key info (2) | card challenge (8)
    // | card cryptogram (8).
    const data = response.data;
    const keyInfo = data.subarray(10, 12);
    const cardChallenge = data.subarray(12, 20);
    const cardCryptogram = data.subarray(20, 28);
    const sequenceCounter = keyInfo.subarray(0, 2);

    session.cardChallenge = new Uint8Array(cardChallenge);
    session.sequenceCounter = new Uint8Array(sequenceCounter);
    context.output.info(
      `Card challenge = ${bytesToHex(cardChallenge)}; ` +
        `sequence counter = ${bytesToHex(sequenceCounter)}`,
    );

    // Verify the card cryptogram using the STATIC MAC key.
    const expectedCardCryptogram = computeCardCryptogram(
      session.keys.mac,
      session.hostChallenge,
      session.sequenceCounter,
      session.cardChallenge,
    );
    if (bytesToHex(expectedCardCryptogram) !== bytesToHex(cardCryptogram)) {
      return this.fail(session, 'Card cryptogram verification failed.');
    }
    context.output.info('Card cryptogram verified.');

    // Derive session keys from both challenges.
    session.sessionKeys = deriveSessionKeys(
      session.keys,
      session.cardChallenge,
      session.hostChallenge,
    );
    context.output.info('Session keys derived.');

    // Compute the host cryptogram and send EXTERNAL AUTHENTICATE.
    const hostCryptogram = computeHostCryptogram(
      session.sessionKeys.mac,
      session.sequenceCounter,
      session.cardChallenge,
      session.hostChallenge,
    );
    session.state = Scp02State.WAIT_EXTERNAL_AUTHENTICATE;
    context.output.info('Sending EXTERNAL AUTHENTICATE');
    return continueWith({
      actionId: 'scp02.external-authenticate',
      type: 'APDU',
      name: 'External Authenticate',
      apdu: {
        cla: SCP02_CLA,
        ins: INS_EXTERNAL_AUTHENTICATE,
        p1: session.securityLevel,
        p2: 0x00,
        data: hostCryptogram,
      },
      sensitive: true,
    });
  }

  private handleExternalAuthenticate(
    context: SkillContext,
    result: ActionResult,
    session: Scp02Session,
  ): SkillResult {
    const response = this.requireApduResponse(result, session);
    if (!response) {
      return failed('EXTERNAL AUTHENTICATE did not return an APDU response.');
    }
    if (response.sw !== SW_OK) {
      return this.fail(
        session,
        `EXTERNAL AUTHENTICATE failed with SW=${swHex(response)}`,
      );
    }
    session.state = Scp02State.ESTABLISHED;
    context.output.info('SCP02 secure channel established.');
    context.output.data({
      sessionKeysDerived: true,
      securityLevel: session.securityLevel,
    });
    return success();
  }

  private requireApduResponse(
    result: ActionResult,
    session: Scp02Session,
  ): ApduResponse | null {
    if (result.actionType !== 'APDU') {
      this.fail(session, `Expected APDU, got ${result.actionType}`);
      return null;
    }
    return (result as ApduActionResult).response;
  }

  private fail(session: Scp02Session, message: string): SkillResult {
    session.state = Scp02State.FAILED;
    return failed(message);
  }
}

function swHex(response: ApduResponse): string {
  return response.sw.toString(16).padStart(4, '0');
}
