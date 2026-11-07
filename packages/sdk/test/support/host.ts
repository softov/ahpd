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
import { sdk, resetSdk, wrote } from './claude-sdk.js';

export { sdk, resetSdk, wrote };

/** The CLIs that belong to a session. The boot probe is not one of them. */
export const sessionQueries = () => sdk.queries.filter((q) => q.options.canUseTool !== undefined);

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

/**
 * What an older VS Code window says at `initialize`: it names itself, and
 * declares the `ahp-session:` URIs it addresses and no opaque chat, so a
 * session it makes has the shaped default chat it computes from the session.
 */
export const OLDER_WINDOW = { clientInfo: { name: 'vscode-editor-window', title: 'VS Code' }, _meta: { 'vscode.ahpSessionUris': true } };

/** A connected client with one session, subscribed to both its channels; `extra` is what the client says at `initialize`. */
export async function running(over: Partial<HostOptions> = {}, extra: Record<string, unknown> = {}) {
  const host = serving('/home/softov', [], over);
  const p = peer();
  const client = host.accept(p);
  // Root included: a catalogue notification goes to the connections watching
  // the root channel and to no others, so a client that never subscribed to
  // it hears nothing - correctly.
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'], ...extra }));
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

/**
 * A session's default chat, read off the session's state as `running` reads it:
 * the host mints a new session's, so a case reads it rather than spelling it.
 * Subscribes the client to the session, as every client that opens one is.
 */
export async function defaultChatOf(client: ReturnType<ReturnType<typeof createHost>['accept']>, session: string): Promise<string> {
  const opened = await client.handle({ method: 'subscribe', params: { channel: session } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  return opened.snapshot.state.defaultChat;
}

/**
 * A session's first message, sent on the chat named.
 *
 * A session made fresh is provisional until its first message, which announces
 * it: until then no listing holds it, no count includes it and nobody is told
 * of it, as VS Code's host keeps a session its provider made provisional.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6347-L6362
 */
export async function firstMessage(client: ReturnType<ReturnType<typeof createHost>['accept']>, chatUri: string, text = 'hi'): Promise<void> {
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 'first', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text } } },
  });
  await settle();
}

/**
 * The root's `showExternalSessions`, pushed as a window pushes it: which of the
 * sessions a backend lists that this host never ran a listing shows. A case
 * about a backend's own transcripts lists them by the mode it means.
 */
export async function showExternal(client: ReturnType<ReturnType<typeof createHost>['accept']>, mode = 'last30Days'): Promise<void> {
  await client.handle({ method: 'dispatchAction', params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { showExternalSessions: mode } } } });
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

/**
 * Past the catalogue's 100 ms debounce, so every row that moved has been said,
 * as VS Code's host says a session's moves together once they are quiet.
 */
export const flushed = async (): Promise<void> => {
  await new Promise((r) => { setTimeout(r, 120); });
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
