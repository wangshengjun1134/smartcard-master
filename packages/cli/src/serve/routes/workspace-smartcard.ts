/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Application, RequestHandler } from 'express';
import {
  bytesToHex,
  hexToBytes,
  type SmartCardRuntime,
} from '@qwen-code/qwen-code-core';
import type { SendBridgeError } from '../server/error-response.js';

interface RegisterSmartCardRoutesDeps {
  runtime: SmartCardRuntime;
  mutate: (opts?: { strict?: boolean }) => RequestHandler;
  sendBridgeError: SendBridgeError;
}

/**
 * Process-level smart-card routes. The reader connection is a process-wide
 * resource, so these routes are NOT workspace-qualified; the single runtime
 * instance is shared by the console and (eventually) agent tools.
 */
export function registerSmartCardRoutes(
  app: Application,
  deps: RegisterSmartCardRoutesDeps,
): void {
  const { runtime, mutate, sendBridgeError } = deps;

  app.get('/smartcard/readers', async (_req, res) => {
    try {
      const readers = await runtime.listReaders();
      res.status(200).json({
        readers,
        activeReader: runtime.getCardSession(),
      });
    } catch (err) {
      sendBridgeError(res, err, { route: 'GET /smartcard/readers' });
    }
  });

  app.post('/smartcard/connect', mutate(), async (req, res) => {
    const readerId = req.body?.['readerId'];
    if (typeof readerId !== 'string' || !readerId.trim()) {
      res.status(400).json({
        error: 'readerId is required',
        code: 'invalid_reader_id',
      });
      return;
    }
    try {
      const atr = await runtime.connect(readerId);
      res.status(200).json({ atr, session: runtime.getCardSession() });
    } catch (err) {
      sendBridgeError(res, err, { route: 'POST /smartcard/connect' });
    }
  });

  app.post('/smartcard/disconnect', mutate(), async (_req, res) => {
    try {
      await runtime.disconnect();
      res.status(200).json({ session: runtime.getCardSession() });
    } catch (err) {
      sendBridgeError(res, err, { route: 'POST /smartcard/disconnect' });
    }
  });

  app.post('/smartcard/reset', mutate(), async (_req, res) => {
    try {
      const atr = await runtime.reset();
      res.status(200).json({ atr, session: runtime.getCardSession() });
    } catch (err) {
      sendBridgeError(res, err, { route: 'POST /smartcard/reset' });
    }
  });

  app.post('/smartcard/apdu', mutate(), async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;
    const { cla, ins, p1, p2 } = body ?? {};
    if (
      !Number.isInteger(cla) ||
      !Number.isInteger(ins) ||
      !Number.isInteger(p1) ||
      !Number.isInteger(p2)
    ) {
      res.status(400).json({
        error: 'cla, ins, p1, p2 must be integers',
        code: 'invalid_apdu',
      });
      return;
    }
    const data = body?.['data'];
    const le = body?.['le'];
    if (data !== undefined && typeof data !== 'string') {
      res.status(400).json({
        error: 'data must be a hex string',
        code: 'invalid_apdu',
      });
      return;
    }
    if (le !== undefined && !Number.isInteger(le)) {
      res.status(400).json({
        error: 'le must be an integer',
        code: 'invalid_apdu',
      });
      return;
    }
    try {
      const response = await runtime.sendApdu({
        cla: Number(cla),
        ins: Number(ins),
        p1: Number(p1),
        p2: Number(p2),
        ...(data !== undefined ? { data: hexToBytes(data) } : {}),
        ...(le !== undefined ? { le: Number(le) } : {}),
      });
      res.status(200).json({
        data: bytesToHex(response.data),
        sw1: response.sw1,
        sw2: response.sw2,
        sw: response.sw,
      });
    } catch (err) {
      sendBridgeError(res, err, { route: 'POST /smartcard/apdu' });
    }
  });

  app.get('/smartcard/skills', (_req, res) => {
    res.status(200).json({
      skills: runtime.listSkills().map((skill) => ({
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
        category: skill.category,
      })),
    });
  });

  app.post('/smartcard/skills/:skillId/execute', mutate(), async (req, res) => {
    const skillId = req.params['skillId'];
    if (!skillId || typeof skillId !== 'string') {
      res.status(400).json({
        error: 'skillId path parameter is required',
        code: 'invalid_skill_id',
      });
      return;
    }
    const input = (req.body?.['input'] as Record<string, unknown>) ?? {};
    try {
      const result = await runtime.executeSkill(skillId, input);
      res.status(200).json(result);
    } catch (err) {
      sendBridgeError(res, err, {
        route: 'POST /smartcard/skills/:skillId/execute',
      });
    }
  });
}
