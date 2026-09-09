/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/** GlobalPlatform SCP02 APDU constants. */
export const SCP02_CLA = 0x80;
export const INS_INITIALIZE_UPDATE = 0x50;
export const INS_EXTERNAL_AUTHENTICATE = 0x82;

/** GlobalPlatform SELECT (used to select the target security domain). */
export const SELECT_CLA = 0x00;
export const SELECT_INS = 0xa4;
export const SELECT_P1_BY_AID = 0x04;

/** Security-level bits for EXTERNAL AUTHENTICATE (SCP02). */
export const SECURITY_LEVEL_CMAC = 0x01;
export const SECURITY_LEVEL_CDECRYPTION = 0x02;
export const SECURITY_LEVEL_RMAC = 0x10;
export const SECURITY_LEVEL_RENCRYPTION = 0x20;

/** Lengths of SCP02 protocol fields, in bytes. */
export const HOST_CHALLENGE_LENGTH = 8;
export const CARD_CHALLENGE_LENGTH = 8;
export const CRYPTOGRAM_LENGTH = 8;
export const SEQUENCE_COUNTER_LENGTH = 2;
export const KEY_DIVERSIFICATION_DATA_LENGTH = 10;
export const KEY_INFO_LENGTH = 2;
export const INITIALIZE_UPDATE_RESPONSE_LENGTH = 28;
