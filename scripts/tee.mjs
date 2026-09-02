#!/usr/bin/env node
/**
 * Every frame, both ways, written down.
 *
 * A proxy that sits between a client and a host and records the JSON-RPC that
 * passes through it. Nothing here understands AHP: it copies bytes and appends
 * a line per frame, because the question it answers is what was *actually*
 * sent - which is the one question a log on either end cannot answer.
 *
 *   node scripts/tee.mjs --listen 9204 --upstream ws://127.0.0.1:9187
 *
 * Then point the client at ws://127.0.0.1:9204 instead of the host. The
 * recording is JSONL, one frame per line, `from` being `client` or `host`.
 */
import { createServer } from 'node:http';
import { appendFileSync, writeFileSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? fallback : process.argv[at + 1];
};
const port = Number(arg('listen', 9204));
const upstream = arg('upstream', 'ws://127.0.0.1:9187');
const out = arg('out', 'ahp-wire.jsonl');
const quiet = process.argv.includes('--quiet');

writeFileSync(out, '');
console.log(`tee ws://127.0.0.1:${port} -> ${upstream}, writing ${out}`);

/** One frame, as it went past. Parsed only to summarise it on stdout. */
const note = (from, raw) => {
  appendFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), from, frame: raw })}\n`);
  if (quiet) return;
  let m;
  try { m = JSON.parse(raw); } catch { console.log(`${from} > (not JSON, ${raw.length}b)`); return; }
  const arrow = from === 'client' ? '->' : '<-';
  if (m.method === 'action') {
    const p = m.params ?? {};
    console.log(`${arrow} action ${p.action?.type} on ${p.channel} seq=${p.serverSeq}`
      + `${p.origin ? ` origin=${p.origin.clientId}/${p.origin.clientSeq}` : ''}`
      + `${p.rejectionReason ? ` REFUSED: ${p.rejectionReason}` : ''}`);
  } else if (m.method) {
    console.log(`${arrow} ${m.method}${m.id !== undefined ? ` #${m.id}` : ''} ${m.params?.channel ?? ''}`);
  } else if (m.error) {
    console.log(`${arrow} #${m.id} ERROR ${m.error.code} ${m.error.message}`);
  } else {
    console.log(`${arrow} #${m.id} ok`);
  }
};

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (down, request) => {
  // The path and query go up verbatim, because that is where a connection
  // token lives and a proxy that dropped it would be refused rather than
  // transparent.
  const target = new URL(upstream);
  const asked = new URL(request.url ?? '/', 'http://placeholder');
  target.pathname = asked.pathname;
  target.search = asked.search;
  const up = new WebSocket(target.toString(), { headers: { ...request.headers, host: target.host } });

  /** Frames the client sent before the upstream was ready. */
  const waiting = [];
  up.on('open', () => { for (const f of waiting) up.send(f); waiting.length = 0; });
  down.on('message', (data) => {
    const raw = data.toString();
    note('client', raw);
    if (up.readyState === WebSocket.OPEN) up.send(raw); else waiting.push(raw);
  });
  up.on('message', (data) => { const raw = data.toString(); note('host', raw); down.send(raw); });

  const bothGo = (why) => { try { down.close(); } catch {} try { up.close(); } catch {} if (!quiet) console.log(`-- ${why}`); };
  down.on('close', () => bothGo('client hung up'));
  up.on('close', () => bothGo('host hung up'));
  down.on('error', (e) => bothGo(`client error: ${e.message}`));
  up.on('error', (e) => bothGo(`host error: ${e.message}`));
});

server.listen(port, '127.0.0.1');
