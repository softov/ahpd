#!/usr/bin/env node
/**
 * A stand-in for the host inside a container.
 *
 * One JSON answer per line of JSON input, and one line that is not a frame
 * before it starts, so a test can tell the relay's frames from the container's
 * own noise. It is not `ahpd`: the launcher's tests are about the process, the
 * pipes and the line framing, and the real host is driven over them in
 * `test/container-relay.test.ts`.
 */

import { createInterface } from 'node:readline';

process.stdout.write('nested host ready\n');
process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'ready', params: { pid: process.pid } })}\n`);

const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  let held;
  try {
    held = JSON.parse(line);
  } catch {
    process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: held.id ?? null, result: { echo: held.method ?? null } })}\n`);
});
input.on('close', () => process.exit(0));
