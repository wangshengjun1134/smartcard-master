/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReaderInfo } from './transport/types.js';
import type { CardSession } from './runtime/types.js';
import type { SkillExecutionResult } from './skills/types.js';

export const SMARTCARD_DAEMON_URL_ENV = 'QWEN_SMARTCARD_DAEMON_URL';
export const SMARTCARD_DAEMON_TOKEN_ENV = 'QWEN_SMARTCARD_DAEMON_TOKEN';

/** Whether this process has a daemon to proxy smart-card operations to. */
export function hasSmartCardDaemonClient(): boolean {
  return process.env[SMARTCARD_DAEMON_URL_ENV] !== undefined;
}

export interface SmartCardReadersResult {
  readers: ReaderInfo[];
  activeReader: CardSession;
}

export interface SmartCardConnectResult {
  atr: string;
  session: CardSession;
}

export interface SmartCardDisconnectResult {
  session: CardSession;
}

export interface SmartCardResetResult {
  atr: string;
  session: CardSession;
}

export interface SmartCardApduResult {
  data: string;
  sw1: number;
  sw2: number;
  sw: number;
}

function baseUrl(): string {
  const url = process.env[SMARTCARD_DAEMON_URL_ENV];
  if (!url) {
    throw new Error(
      'Smart-card support requires a desktop daemon. ' +
        `${SMARTCARD_DAEMON_URL_ENV} is not set.`,
    );
  }
  return url.replace(/\/$/, '');
}

function authHeaders(): Record<string, string> {
  const token = process.env[SMARTCARD_DAEMON_TOKEN_ENV];
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(
      body.error ?? `Smart-card daemon request failed (${res.status})`,
    );
  }
  return (await res.json()) as T;
}

export async function smartcardListReaders(): Promise<SmartCardReadersResult> {
  return request<SmartCardReadersResult>('/smartcard/readers');
}

export async function smartcardConnect(
  readerId: string,
): Promise<SmartCardConnectResult> {
  return request<SmartCardConnectResult>('/smartcard/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readerId }),
  });
}

export async function smartcardDisconnect(): Promise<SmartCardDisconnectResult> {
  return request<SmartCardDisconnectResult>('/smartcard/disconnect', {
    method: 'POST',
  });
}

export async function smartcardReset(): Promise<SmartCardResetResult> {
  return request<SmartCardResetResult>('/smartcard/reset', {
    method: 'POST',
  });
}

export async function smartcardSendApdu(apdu: {
  cla: number;
  ins: number;
  p1: number;
  p2: number;
  data?: string;
  le?: number;
}): Promise<SmartCardApduResult> {
  return request<SmartCardApduResult>('/smartcard/apdu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(apdu),
  });
}

export async function smartcardExecuteSkill(
  skillId: string,
  input: Record<string, unknown>,
): Promise<SkillExecutionResult> {
  return request<SkillExecutionResult>(
    `/smartcard/skills/${encodeURIComponent(skillId)}/execute`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
    },
  );
}
