/**
 * Hello World Skill v2 - Multi-Step Execution with Context Management
 *
 * Demonstrates the complete SmartCard Skill architecture:
 *   - State machine (START → SELECT → GET STATUS → READ BINARY → SUCCESS)
 *   - Session context (ExecutionContext shared across steps)
 *   - Multi-step APDU execution with intermediate state
 *   - Error handling and retry logic
 *   - Cross-language IPC protocol (JSON Lines)
 *
 * This skill is self-contained with no external dependencies.
 *
 * Design doc: docs-smartcard/SmartCard_Agent_Skills_Desgin_v2.4.md
 */

// ── State Definitions ────────────────────────────────────────────────

type Step =
  | 'START'
  | 'WAIT_SELECT'
  | 'WAIT_GET_STATUS'
  | 'WAIT_READ_BINARY'
  | 'SUCCESS'
  | 'FAILED';

// ── Session Context ──────────────────────────────────────────────────

interface ExecutionContext {
  executionId: string;
  step: Step;
  atr: string | null;
  selectResponse: number[] | null;
  getStatusResponse: number[] | null;
  readBinaryData: number[] | null;
  retryCount: number;
  maxRetries: number;
}

// ── IPC Utilities ────────────────────────────────────────────────────

function sendMessage(msg: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function emitOutput(
  ctx: ExecutionContext,
  level: string,
  message: string,
  data?: unknown,
): void {
  sendMessage({
    type: 'output',
    executionId: ctx.executionId,
    level,
    message: `[${ctx.step}] ${message}`,
    ...(data !== undefined && { data }),
  });
}

function sendAction(
  ctx: ExecutionContext,
  action: Record<string, unknown>,
): void {
  sendMessage({
    type: 'skill_action',
    executionId: ctx.executionId,
    action,
  });
}

function finishSuccess(ctx: ExecutionContext, data?: unknown): void {
  ctx.step = 'SUCCESS';
  sendMessage({
    type: 'execution_finished',
    executionId: ctx.executionId,
    status: 'SUCCESS',
    data,
  });
}

function finishFailed(ctx: ExecutionContext, error: string): void {
  ctx.step = 'FAILED';
  sendMessage({
    type: 'execution_finished',
    executionId: ctx.executionId,
    status: 'FAILED',
    error,
  });
}

// ── APDU Helpers ─────────────────────────────────────────────────────

function buildApdu(
  cla: number,
  ins: number,
  p1: number,
  p2: number,
  data?: number[],
  le?: number,
): Record<string, unknown> {
  const apdu: Record<string, unknown> = { cla, ins, p1, p2 };
  if (data) apdu['data'] = data;
  if (le !== undefined) apdu['le'] = le;
  return apdu;
}

function swOk(sw: number): boolean {
  return sw === 0x9000;
}

function swHex(sw: number): string {
  return sw.toString(16).padStart(4, '0').toUpperCase();
}

// ── Step Implementations ─────────────────────────────────────────────

/**
 * Step 1: SELECT DF.GCR (Global Card Registry)
 * Selects the SIM card's main application directory.
 */
function stepSelect(ctx: ExecutionContext): void {
  emitOutput(ctx, 'INFO', 'SELECT DF.GCR (AID: A000000003000000)');

  sendAction(ctx, {
    id: 'select-df-gcr',
    type: 'APDU',
    name: 'SELECT DF.GCR',
    description: 'Select Global Card Registry application',
    apdu: buildApdu(
      0x00, // CLA
      0xa4, // INS: SELECT
      0x04, // P1: Select by DF name
      0x00, // P2: First or only occurrence
      [0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00], // AID
    ),
  });
}

/**
 * Step 2: GET STATUS
 * Retrieves metadata about the currently selected file.
 */
function stepGetStatus(ctx: ExecutionContext): void {
  emitOutput(ctx, 'INFO', 'GET STATUS (query file metadata)');

  sendAction(ctx, {
    id: 'get-status',
    type: 'APDU',
    name: 'GET STATUS',
    description: 'Get status of currently selected file',
    apdu: buildApdu(
      0x00, // CLA
      0xf2, // INS: GET STATUS
      0x00, // P1
      0x00, // P2
      undefined,
      0x00, // Le: return full response
    ),
  });
}

/**
 * Step 3: READ BINARY (EF.ICCID)
 * Reads the ICCID file (11 bytes, BCD encoded).
 */
function stepReadBinary(ctx: ExecutionContext): void {
  emitOutput(ctx, 'INFO', 'READ BINARY EF.ICCID (offset 0, 11 bytes)');

  sendAction(ctx, {
    id: 'read-binary-iccid',
    type: 'APDU',
    name: 'READ BINARY',
    description: 'Read ICCID file',
    apdu: buildApdu(
      0x00, // CLA
      0xb0, // INS: READ BINARY
      0x00, // P1: High order address byte
      0x00, // P2: Low order address byte
      undefined,
      0x0b, // Le: 11 bytes (ICCID length)
    ),
  });
}

/**
 * Parse ICCID from BCD-encoded bytes (nibble swap).
 */
function parseIccid(data: number[]): string {
  const iccid: string[] = [];
  for (const byte of data) {
    const high = (byte >> 4) & 0x0f;
    const low = byte & 0x0f;

    if (low === 0xf) {
      // Padding
      if (high !== 0xf) iccid.push(high.toString());
      break;
    }
    iccid.push(low.toString());
    if (high !== 0xf) iccid.push(high.toString());
  }
  return iccid.join('');
}

// ── State Machine ────────────────────────────────────────────────────

/**
 * Handle start message: initialize context and execute first step.
 */
function handleStart(msg: Record<string, unknown>): void {
  const ctx: ExecutionContext = {
    executionId: msg['executionId'] as string,
    step: 'START',
    atr: null,
    selectResponse: null,
    getStatusResponse: null,
    readBinaryData: null,
    retryCount: 0,
    maxRetries: 3,
  };

  // Store context in global for access from handleActionResult
  (global as unknown as { _ctx?: ExecutionContext })._ctx = ctx;

  const cardSession = msg['cardSession'] as Record<string, unknown> | undefined;
  const input = msg['input'] as Record<string, unknown> | undefined;

  emitOutput(ctx, 'INFO', '=== Hello World v2 (Multi-Step) ===');
  emitOutput(ctx, 'INFO', `Input: ${JSON.stringify(input || {})}`);
  emitOutput(
    ctx,
    'INFO',
    `Card connected: ${cardSession?.['connected'] || false}`,
  );
  emitOutput(ctx, 'INFO', `ATR: ${cardSession?.['atr'] || 'N/A'}`);
  ctx.atr = (cardSession?.['atr'] as string) || null;

  if (!cardSession?.['connected']) {
    emitOutput(
      ctx,
      'WARN',
      'No card connected, cannot execute multi-step flow',
    );
    finishFailed(ctx, 'Card not connected');
    return;
  }

  // Begin Step 1: SELECT
  ctx.step = 'WAIT_SELECT';
  emitOutput(ctx, 'INFO', 'Starting multi-step execution...');
  stepSelect(ctx);
}

/**
 * Handle action result: process response and proceed to next step.
 */
function handleActionResult(msg: Record<string, unknown>): void {
  const ctx = (global as unknown as { _ctx?: ExecutionContext })._ctx!;

  if (!ctx) {
    process.stderr.write('No execution context found\n');
    return;
  }

  const success = msg['success'] as boolean;
  const actionId = msg['actionId'] as string;

  if (!success) {
    // Error handling: retry or abort
    ctx.retryCount++;
    if (ctx.retryCount < ctx.maxRetries) {
      emitOutput(
        ctx,
        'WARN',
        `Action ${actionId} failed, retrying (${ctx.retryCount}/${ctx.maxRetries})...`,
      );
      // Re-send the current step's action
      switch (ctx.step) {
        case 'WAIT_SELECT':
          stepSelect(ctx);
          break;
        case 'WAIT_GET_STATUS':
          stepGetStatus(ctx);
          break;
        case 'WAIT_READ_BINARY':
          stepReadBinary(ctx);
          break;
        default:
          finishFailed(
            ctx,
            `Action ${actionId} failed after ${ctx.maxRetries} retries`,
          );
      }
    } else {
      finishFailed(
        ctx,
        `Action ${actionId} failed permanently: ${msg['error'] || 'Unknown error'}`,
      );
    }
    return;
  }

  // Success handling: parse response and proceed
  const response = msg['response'] as Record<string, unknown> | undefined;
  const sw = (response?.['sw'] as number) || 0;
  const data = (response?.['data'] as number[]) || [];

  if (!swOk(sw)) {
    emitOutput(ctx, 'ERROR', `SW=${swHex(sw)}, expected 9000`);
    finishFailed(ctx, `APDU failed with SW=${swHex(sw)}`);
    return;
  }

  switch (ctx.step) {
    case 'WAIT_SELECT': {
      // SELECT succeeded: save response, proceed to GET STATUS
      ctx.selectResponse = data;
      emitOutput(ctx, 'INFO', `SELECT OK, FCI length: ${data.length} bytes`);

      ctx.step = 'WAIT_GET_STATUS';
      ctx.retryCount = 0;
      stepGetStatus(ctx);
      break;
    }

    case 'WAIT_GET_STATUS': {
      // GET STATUS succeeded: save metadata, proceed to READ BINARY
      ctx.getStatusResponse = data;
      emitOutput(ctx, 'INFO', `GET STATUS OK, metadata: ${data.length} bytes`);
      emitOutput(
        ctx,
        'DATA',
        `GET STATUS response: ${JSON.stringify({ get_status_response: data })}`,
      );

      ctx.step = 'WAIT_READ_BINARY';
      ctx.retryCount = 0;
      stepReadBinary(ctx);
      break;
    }

    case 'WAIT_READ_BINARY': {
      // READ BINARY succeeded: parse ICCID, finish execution
      ctx.readBinaryData = data;
      const iccid = parseIccid(data);

      emitOutput(ctx, 'INFO', `READ BINARY OK, ${data.length} bytes received`);
      emitOutput(ctx, 'INFO', `ICCID: ${iccid}`);
      emitOutput(
        ctx,
        'DATA',
        `ICCID data: ${JSON.stringify({ iccid, raw_hex: Buffer.from(data).toString('hex').toUpperCase(), bytes_count: data.length })}`,
      );

      finishSuccess(ctx, {
        iccid,
        atr: ctx.atr,
        steps_executed: ['SELECT', 'GET STATUS', 'READ BINARY'],
        final_state: ctx.step,
      });
      break;
    }

    default:
      finishFailed(ctx, `Unexpected step: ${ctx.step}`);
  }
}

// ── Main Loop ────────────────────────────────────────────────────────

function main(): void {
  process.stdin.setEncoding('utf8');

  let buffer = '';

  process.stdin.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep last incomplete line

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const msg = JSON.parse(line) as Record<string, unknown>;

        if (msg['type'] === 'start') {
          handleStart(msg);
        } else if (msg['type'] === 'action_result') {
          handleActionResult(msg);
        } else if (msg['type'] === 'stop') {
          const ctx = (global as unknown as { _ctx?: ExecutionContext })._ctx;
          if (ctx) {
            emitOutput(ctx, 'INFO', 'Received stop signal');
          }
          process.exit(0);
        }
      } catch (err) {
        process.stderr.write(
          `Parse error: ${err instanceof Error ? err.message : err}\n`,
        );
      }
    }
  });
}

main();
