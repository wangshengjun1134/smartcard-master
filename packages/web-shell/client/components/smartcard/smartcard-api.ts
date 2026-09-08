/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDaemonAuthHeaders, getDaemonBaseUrl } from '../../config/daemon.js';

export type ReaderStatus = 'connected' | 'disconnected' | 'busy' | 'error';

export interface ReaderInfo {
  id: string;
  name: string;
  status: ReaderStatus;
  cardPresent: boolean;
  atr?: string;
}

export interface CardSession {
  readerId: string | null;
  atr: string | null;
  connected: boolean;
}

export interface ApduResponse {
  data: string;
  sw1: number;
  sw2: number;
  sw: number;
}

export interface SmartCardSkillInfo {
  skillId: string;
  name: string;
  description: string;
  category: string;
}

export interface SkillExecutionResult {
  status: 'SUCCESS' | 'FAILED' | 'CANCELLED';
  data?: unknown;
  error?: string;
  events: Array<{ level: string; message: string; data?: unknown }>;
}

function baseUrl(): string {
  return getDaemonBaseUrl().replace(/\/$/, '');
}

function authHeaders(): Record<string, string> {
  return { ...(getDaemonAuthHeaders() as Record<string, string>) };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `SmartCard request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function listReaders(): Promise<{
  readers: ReaderInfo[];
  activeReader: CardSession;
}> {
  return request('/smartcard/readers');
}

export async function connectReader(readerId: string): Promise<{
  atr: string;
  session: CardSession;
}> {
  return request('/smartcard/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ readerId }),
  });
}

export async function disconnectReader(): Promise<{
  session: CardSession;
}> {
  return request('/smartcard/disconnect', { method: 'POST' });
}

export async function resetCard(): Promise<{
  atr: string;
  session: CardSession;
}> {
  return request('/smartcard/reset', { method: 'POST' });
}

export async function sendApdu(apdu: {
  cla: number;
  ins: number;
  p1: number;
  p2: number;
  data?: string;
  le?: number;
}): Promise<ApduResponse> {
  return request('/smartcard/apdu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(apdu),
  });
}

export async function listSkills(): Promise<{
  skills: SmartCardSkillInfo[];
}> {
  return request('/smartcard/skills');
}

export async function executeSkill(
  skillId: string,
  input: Record<string, unknown>,
): Promise<SkillExecutionResult> {
  return request(`/smartcard/skills/${encodeURIComponent(skillId)}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input }),
  });
}
