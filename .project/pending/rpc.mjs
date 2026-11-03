// Send one AHP request to a daemon and print the answer.
//
//   node rpc.mjs <method> [paramsJSON] [waitMs]
//
// AHPD_URL and AHPD_TOKEN_FILE name the daemon. Without them it is the test
// daemon of test-daemon.sh: ws://127.0.0.1:39200 and ~/ahpd-check/token.
// It prints `ANSWER <json>`, and with ALL=1 every notification too.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const require = createRequire(new URL('../../packages/server/package.json', import.meta.url));
const { WebSocket } = require('ws');
const [method, params = '{}', wait = '5000'] = process.argv.slice(2);
if (method === undefined) {
  console.error('usage: node rpc.mjs <method> [paramsJSON] [waitMs]');
  process.exit(2);
}
const url = process.env.AHPD_URL ?? 'ws://127.0.0.1:39200';
const token = readFileSync(process.env.AHPD_TOKEN_FILE ?? `${homedir()}/ahpd-check/token`, 'utf-8').trim();
const ws = new WebSocket(`${url}/?tkn=${encodeURIComponent(token)}`);
const send = (message) => ws.send(JSON.stringify(message));
ws.on('open', () => send({ id: 1, method: 'initialize', params: { clientId: 'pending-rpc', protocolVersions: ['0.9.0'], initialSubscriptions: [] } }));
ws.on('message', (raw) => {
  const message = JSON.parse(String(raw));
  if (message.id === 1) {
    if (message.error) { console.log('initialize failed', JSON.stringify(message.error)); process.exit(1); }
    send({ id: 2, method, params: JSON.parse(params) });
    setTimeout(() => process.exit(0), Number(wait));
    return;
  }
  if (message.id === 2) {
    console.log('ANSWER', JSON.stringify(message.result ?? { error: message.error }));
    if (!process.env.ALL) process.exit(0);
  }
  else if (process.env.ALL) console.log('NOTE', JSON.stringify(message));
});
ws.on('close', (code, why) => { console.log('CLOSED', code, String(why)); process.exit(0); });
ws.on('error', (error) => { console.log('ERROR', error.message); process.exit(1); });
