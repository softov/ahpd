/**
 * One real turn through `@ahpd/agent-acp`, against GitHub Copilot's ACP server.
 *
 * Manual, and not part of the suite: it spawns `copilot --acp`, which needs a
 * signed-in GitHub Copilot and spends a model call. What it proves is the one
 * thing the scripted fixture cannot - that the bridge's handshake, session,
 * prompt, stream mapping and mode catalogue hold against a server somebody
 * else wrote.
 *
 * Run it after `pnpm build`:
 *
 * ```bash
 * node scripts/acp-smoke.mts
 * ```
 *
 * On a machine whose `$HOME` is writable it needs nothing else. When `$HOME` is
 * read-only, as under a sandbox, give it somewhere to write:
 *
 * ```bash
 * COPILOT_HOME=/tmp/copilot-home node scripts/acp-smoke.mts
 * ```
 *
 * A different ACP server works just as well: change `command`, `args` and the
 * provider below. Exit status is 0 only when a turn completed with no error.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHost } from '@ahpd/sdk';
import type { Peer } from '@ahpd/sdk';
import { acpAgent } from '../packages/agent-acp/dist/index.js';

const notes: { method: string; params: unknown }[] = [];
const peer = {
  notes,
  send: () => {},
  notify: (method: string, params: unknown) => notes.push({ method, params }),
  request: async () => ({}),
  answered: () => {},
  close: () => {},
} as unknown as Peer;

const home = process.env.COPILOT_HOME;
const path = mkdtempSync(join(tmpdir(), 'acp-smoke-'));
const host = createHost({
  path,
  agents: [acpAgent({
    command: 'copilot',
    args: ['--acp'],
    provider: 'copilot',
    displayName: 'Copilot',
    ...(home === undefined ? {} : { env: { COPILOT_HOME: home } }),
  })],
});

const client = host.accept(peer);
const ready = await client.handle({
  method: 'initialize',
  params: { clientId: 'smoke', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
}) as { snapshots: { state: { agents: { provider: string }[] } }[] };
console.log('providers:', JSON.stringify(ready.snapshots[0]?.state.agents.map((one) => one.provider)));

const uri = 'ahp-session:/smoke';
const chatUri = 'ahp-chat:/smoke';
await client.handle({
  method: 'createSession',
  params: { channel: uri, provider: 'copilot', workingDirectories: [`file://${path}`] },
});
await client.handle({ method: 'subscribe', params: { channel: uri } });
await client.handle({ method: 'subscribe', params: { channel: chatUri } });

const actions = () => notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((e) => e.channel === chatUri)
  .map((e) => e.action);
const ended = (): boolean => actions().some((one) => {
  const type = String(one.type);
  return type === 'chat/turnComplete' || type === 'chat/turnCancelled' || type === 'chat/error';
});

// The mode catalogue Copilot names, which the bridge maps to `permissionMode`.
// Read after the turn, because the modes arrive with `session/new` and the
// session asks for one only when it is first needed.
const configOf = async (): Promise<Record<string, { enum?: string[] }> | undefined> => {
  const held = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { config?: { schema?: { properties?: Record<string, { enum?: string[] }> } } } };
  }).snapshot.state;
  return held.config?.schema?.properties;
};

void client.handle({
  method: 'dispatchAction',
  params: {
    channel: chatUri,
    action: {
      type: 'chat/turnStarted',
      turnId: 't1',
      message: { text: 'Reply with exactly the word PONG and nothing else.' },
    },
  },
});

const began = Date.now();
while (!ended() && Date.now() - began < 180_000) await new Promise((r) => { setTimeout(r, 250); });

const said = actions().filter((one) => one.type === 'chat/delta').map((one) => String(one.content)).join('');
const failed = actions().filter((one) => one.type === 'chat/error');
console.log('answer:', JSON.stringify(said.trim()));
console.log('error:', JSON.stringify(failed.map((one) => one.part)));
console.log('modes:', JSON.stringify((await configOf())?.permissionMode?.enum ?? null));

await client.handle({ method: 'disposeSession', params: { channel: uri } });
rmSync(path, { recursive: true, force: true });
// A completed turn that said something is the pass; anything else is not.
process.exit(failed.length === 0 && said.trim() !== '' ? 0 : 1);
