/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

/** Semantic states of an SCP02 channel-establishment execution. */
export enum Scp02State {
  START = 'START',
  WAIT_RESET = 'WAIT_RESET',
  WAIT_SELECT = 'WAIT_SELECT',
  WAIT_INITIALIZE_UPDATE = 'WAIT_INITIALIZE_UPDATE',
  WAIT_EXTERNAL_AUTHENTICATE = 'WAIT_EXTERNAL_AUTHENTICATE',
  ESTABLISHED = 'ESTABLISHED',
  FAILED = 'FAILED',
}
