/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { type Application } from 'express';
import {
  bytesToHex,
  hexToBytes,
  type SmartCardRuntime,
} from '@qwen-code/qwen-code-core';
import { bearerAuth } from '../auth.js';
import {
  singleTokenCredentials,
  type ListenerScopedCredentials,
} from '../local-control/credentials.js';
import type { SendBridgeError } from '../server/error-response.js';

interface RegisterSmartCardRoutesDeps {
  runtime: SmartCardRuntime;
  /** The daemon's operator bearer token (Web Shell console clients). */
  mainToken?: string;
  /** Scoped token handed to the ACP child for its smart-card tools. */
  scopedToken?: string;
  sendBridgeError: SendBridgeError;
}

/** Credential accepting either the operator token or the scoped smart-card token. */
function dualTokenCredentials(
  mainToken: string | undefined,
  scopedToken: string | undefined,
): ListenerScopedCredentials {
  const main = singleTokenCredentials(mainToken);
  const scoped = singleTokenCredentials(scopedToken);
  return {
    isOpen: (listener) => main.isOpen(listener) && scoped.isOpen(listener),
    verify: (candidate, listener) =>
      main.verify(candidate, listener) || scoped.verify(candidate, listener),
  };
}

/**
 * Process-level smart-card routes. The reader connection is a process-wide
 * resource, so these routes are NOT workspace-qualified; the single runtime
 * instance is shared by the console and the agent tools (via the ACP child's
 * daemon-client). Registered before the global bearer gate; each route enforces
 * its own dual-token auth.
 */
export function registerSmartCardRoutes(
  app: Application,
  deps: RegisterSmartCardRoutesDeps,
): void {
  const { runtime, mainToken, scopedToken, sendBridgeError } = deps;
  const auth = bearerAuth(dualTokenCredentials(mainToken, scopedToken));
  const parseJson = express.json();

  app.get('/smartcard/readers', auth, async (_req, res) => {
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

  app.post('/smartcard/connect', auth, parseJson, async (req, res) => {
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

  app.post('/smartcard/disconnect', auth, parseJson, async (_req, res) => {
    try {
      await runtime.disconnect();
      res.status(200).json({ session: runtime.getCardSession() });
    } catch (err) {
      sendBridgeError(res, err, { route: 'POST /smartcard/disconnect' });
    }
  });

  app.post('/smartcard/reset', auth, parseJson, async (_req, res) => {
    try {
      const atr = await runtime.reset();
      res.status(200).json({ atr, session: runtime.getCardSession() });
    } catch (err) {
      sendBridgeError(res, err, { route: 'POST /smartcard/reset' });
    }
  });

  app.post('/smartcard/apdu', auth, parseJson, async (req, res) => {
    const body = req.body as Record<string, unknown> | undefined;

    // Support raw hex string: POST { "hex": "00A400023F00" }
    const hex = body?.['hex'];
    if (typeof hex === 'string' && hex.trim()) {
      const cleaned = hex.replace(/\s+/g, '');
      if (cleaned.length < 4 || cleaned.length % 2 !== 0) {
        res.status(400).json({
          error:
            'hex must be a valid hex string (at least 4 bytes, even length)',
          code: 'invalid_apdu',
        });
        return;
      }
      try {
        const apduBytes = hexToBytes(cleaned);
        const response = await runtime.sendApdu({
          cla: apduBytes[0],
          ins: apduBytes[1],
          p1: apduBytes[2],
          p2: apduBytes[3],
          bytes: apduBytes,
        });
        res.status(200).json({
          data: bytesToHex(response.data),
          sw1: response.sw1,
          sw2: response.sw2,
          sw: response.sw,
        });
        return;
      } catch (err) {
        sendBridgeError(res, err, { route: 'POST /smartcard/apdu' });
        return;
      }
    }

    // Legacy format: { cla, ins, p1, p2, data?, le? }
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

  app.get('/smartcard/skills', auth, (_req, res) => {
    res.status(200).json({
      skills: runtime.listSkills().map((skill) => ({
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        enabled: skill.enabled !== false,
      })),
    });
  });

  app.patch(
    '/smartcard/skills/:skillId/enabled',
    auth,
    parseJson,
    async (req, res) => {
      const skillId = req.params['skillId'];
      if (!skillId || typeof skillId !== 'string') {
        res.status(400).json({
          error: 'skillId path parameter is required',
          code: 'invalid_skill_id',
        });
        return;
      }
      const enabled = req.body?.['enabled'];
      if (typeof enabled !== 'boolean') {
        res.status(400).json({
          error: 'enabled must be a boolean',
          code: 'invalid_enabled',
        });
        return;
      }
      try {
        const found = runtime.setSkillEnabled(skillId, enabled);
        if (!found) {
          res.status(404).json({
            error: `Skill "${skillId}" not found`,
            code: 'skill_not_found',
          });
          return;
        }
        res.status(200).json({ skillId, enabled });
      } catch (err) {
        sendBridgeError(res, err, {
          route: 'PATCH /smartcard/skills/:skillId/enabled',
        });
      }
    },
  );

  app.post(
    '/smartcard/skills/:skillId/execute',
    auth,
    parseJson,
    async (req, res) => {
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
    },
  );

  // SSE stream of smart-card operations (APDU exchanges, connect/disconnect/
  // reset). Replays the recent log on connect, then pushes live entries.
  app.get('/smartcard/events', auth, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const write = (op: unknown): void => {
      res.write(`data: ${JSON.stringify(op)}\n\n`);
    };
    for (const op of runtime.getOperations()) {
      write(op);
    }
    const unsubscribe = runtime.onOperation(write);
    req.on('close', () => {
      unsubscribe();
      res.end();
    });
  });
}
