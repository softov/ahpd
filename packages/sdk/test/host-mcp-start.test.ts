/*
 * A start of an MCP server the session's backend does not make: the server
 * is left in an error, in VS Code's words for a provider that cannot start
 * one, and in the backend's own where its start failed.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2026-L2048
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { ROOT } from '../src/host/channels.js';
import { fileResources } from '../src/resources/resources.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Peer } from '../src/types/rpc.js';
import type { Session } from '../src/types/session.js';

const SESSION = 'ahp-session:/one';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-mcp-start-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** An envelope as a client reads it. */
interface Heard {
  channel: string;
  action: Bag;
}

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** The echo backend with one MCP server still starting, whose start answers as `start` does. */
const starting = (start: () => Promise<boolean>): Agent => {
  const base = echo({ path: dir, pace: 0 });
  return {
    ...base,
    create: (given: Start): Session => {
      const session = base.create(given) as Session;
      return {
        ...session,
        customizations: () => [{ type: 'mcpServer', id: 'mcp:desk', uri: 'desk', name: 'desk', enabled: true, state: { kind: 'starting' } }],
        startMcpServer: start,
      };
    },
  };
};

/** The state the server is said to be left in when the client asks it to start. */
const leftIn = async (start: () => Promise<boolean>): Promise<Bag | undefined> => {
  const host = createHost({ path: dir, agents: [starting(start)], resources: fileResources() });
  const heard: Heard[] = [];
  const peer: Peer = {
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method, params) => { if (method === 'action') heard.push(params as Heard); },
  };
  const client = host.accept(peer);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
  await client.handle({ method: 'createSession', params: { channel: SESSION, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: SESSION } });
  await client.handle({ method: 'dispatchAction', params: { channel: SESSION, action: { type: 'session/mcpServerStartRequested', id: 'mcp:desk' } } });
  await settle();
  await host.close();
  return heard.find((one) => one.channel === SESSION && one.action.type === 'session/mcpServerStateChanged')?.action.state as Bag | undefined;
};

it('leaves a server its backend cannot start in VS Code\'s words, and one whose start failed in the backend\'s', async () => {
  expect(await leftIn(async () => false)).toEqual({
    kind: 'error',
    error: { errorType: 'mcp-server-start-failed', message: 'The session provider does not support starting MCP servers.' },
  });
  expect(await leftIn(async () => { throw new Error('desk is offline'); })).toEqual({
    kind: 'error',
    error: { errorType: 'mcp-server-start-failed', message: 'desk is offline' },
  });
});
