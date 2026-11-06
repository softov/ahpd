/*
 * The host, without a socket.
 *
 * `accept` takes a peer and returns a handler, which is the seam that makes
 * this testable: everything the protocol says is decided here, and the
 * WebSocket only carries it. What is checked is the part a client breaks on -
 * which version comes back, what a snapshot contains, and that a method this
 * host does not serve is *said* rather than quietly answered.
 *
 * Not a test file. `vitest` collects `*.test.ts`, and this is imported by the
 * suites that are.
 */

import { randomUUID } from 'node:crypto';
import type { Peer } from '../../src/types/rpc.js';
import type { HostOptions } from '../../src/types/host.js';
import { SIGNED_IN, sdk, resetSdk, wrote } from './claude-sdk.js';

export { SIGNED_IN, sdk, resetSdk, wrote };

/** The CLIs that belong to a session. The boot probe is not one of them. */
export const sessionQueries = () => sdk.queries.filter((q) => q.options.canUseTool !== undefined);

/**
 * The `index`-th in-process server named `name` the sessions built, the last
 * by default: the server a session hands its CLI, whose tools a case calls as
 * the model would.
 */
export const builtServer = (name: string, index = -1) => sdk.built.filter((one) => one.name === name).at(index);

/** How many in-process servers named `name` the sessions built: the index after the newest one's. */
export const builtCount = (name: string): number => sdk.built.filter((one) => one.name === name).length;

export const { createHost } = await import('../../src/host.js');
export const { fileResources, list, read, resolve, complete } = await import('../../src/resources/resources.js');
export const { shellTerminals } = await import('../../src/machines/terminals.js');
export const { gitBranches } = await import('../../src/repo/git.js');
/*
 * What the daemon hands its host, handed here too.
 *
 * These tests drive the same path a host built out of this library takes, and
 * that path includes giving it a filesystem and a shell: `createHost` is the
 * protocol and owns neither.
 */
export const machine = () => ({ resources: fileResources(), terminals: shellTerminals(), directories: gitBranches() });
export const { claude } = await import('../../../agent-claude/src/claude.js');
export const { echo } = await import('../../../../examples/echo/agent.js');
export const { hostTools } = await import('../../src/tools/index.js');
export const { gitChanges } = await import('../../src/sessions/changes.js');

/**
 * The host, serving the backend that ships with it.
 *
 * Every test below drives Claude through `Agent`, which is the same path a
 * host built out of this library takes - so what is checked here is what a
 * third-party backend gets, not a shortcut only the built-in has.
 */
export const serving = (path: string, also: string[] = [], over: Partial<HostOptions> = {}) =>
  createHost({ path, agents: [claude({ paths: [path, ...also] })], ...machine(), ...over });

export function peer(): Peer & { sent: Record<string, unknown>[]; notes: { method: string; params: unknown }[] } {
  const sent: Record<string, unknown>[] = [];
  const notes: { method: string; params: unknown }[] = [];
  return {
    sent,
    notes,
    send: (message) => sent.push(message),
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

export const open = () => serving('/home/softov').accept(peer());

export const hello = (versions: unknown[], extra: Record<string, unknown> = {}) => ({
  method: 'initialize',
  params: { channel: 'ahp-root://', clientId: 'probe', protocolVersions: versions, ...extra },
});

/** A connected client with one session, subscribed to both its channels. */
export async function running(over: Partial<HostOptions> = {}) {
  const host = serving('/home/softov', [], over);
  const p = peer();
  const client = host.accept(p);
  // Root included: a catalogue notification goes to the connections watching
  // the root channel and to no others, so a client that never subscribed to
  // it hears nothing - correctly.
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
  const uri = 'ahp-session:/live';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
  // Read, not assumed. What a session calls its chat is the host's to say and
  // the client's to look up - a test that hard-codes it is testing a spelling
  // rather than the lookup every client actually does.
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { host, client, peer: p, uri, chatUri };
}

export const actions = (p: ReturnType<typeof peer>, channel?: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as {
    channel: string;
    action: Record<string, unknown>;
    serverSeq: number;
    origin?: { clientId: string; clientSeq: number };
    rejectionReason?: string;
  })
  .filter((e) => channel === undefined || e.channel === channel);

export const settle = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Say what the session's own CLI said. */
export async function emit(...frames: Record<string, unknown>[]): Promise<void> {
  const fake = sessionQueries().at(-1);
  if (!fake) throw new Error('no session CLI is running');
  fake.frames.push(...frames);
  fake.wake?.();
  fake.wake = undefined;
  await settle();
}

/**
 * A turn sent on a chat, the chat a session's default when the channel names
 * a session, with no wait for what follows.
 *
 * A Claude session starts its CLI at its first send, as VS Code's Claude
 * session materializes at its first, so a case about the CLI a session runs
 * sends one first.
 */
export async function sendTurn(client: { handle(request: { method: string; params: unknown }): unknown }, channel: string, text = 'hello'): Promise<void> {
  const opened = await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: { defaultChat?: string } } };
  const chat = opened.snapshot.state.defaultChat ?? channel;
  if (chat !== channel) await client.handle({ method: 'subscribe', params: { channel: chat } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: randomUUID(), startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
  });
}

/** A turn sent as `sendTurn` sends one, and answered, so the case's own turns are sends of their own. */
export async function sendAnswered(client: { handle(request: { method: string; params: unknown }): unknown }, channel: string, text = 'hello'): Promise<void> {
  await sendTurn(client, channel, text);
  await settle(8);
  await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
  await settle(8);
}
