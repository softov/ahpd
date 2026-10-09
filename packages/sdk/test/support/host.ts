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

import type { Peer } from '../../src/types/rpc.js';
import type { HostOptions } from '../../src/types/host.js';
import { sdk, resetSdk } from './claude-sdk.js';

export { sdk, resetSdk };

/** The CLIs that belong to a session. The boot probe is not one of them. */
export const sessionQueries = () => sdk.queries.filter((q) => q.options.canUseTool !== undefined);

export const { createHost } = await import('../../src/host.js');
export const { fileResources, list, read, resolve, complete } = await import('../../src/resources.js');
export const { shellTerminals } = await import('../../src/terminals.js');
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
export const { gitChanges } = await import('../../src/changes.js');

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
