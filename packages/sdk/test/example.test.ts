import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * The example, driven as a client drives it.
 *
 * No SDK is mocked here and nothing is spawned: `echo` is a backend written
 * from nothing, so what this checks is that `Agent` is sufficient - that a
 * host given one it has never heard of serves a whole conversation without
 * any part of it reaching for Claude.
 *
 * It is also what keeps the example honest. An example that stopped compiling
 * against the contract it documents would be worse than none.
 */

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

const settle = async (times = 6): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A connected client with one echo session, watching both its channels. */
async function talking() {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo', pace: 0 })] });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  // The chat the host minted for the session, read off its state.
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { host, client, peer: p, uri, chatUri };
}

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((e) => e.channel === channel);

it('advertises the backend it was given, and no other', async () => {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo' })] });
  const client = host.accept(peer());
  const result = await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  }) as { snapshots: { state: { agents: { provider: string }[] } }[] };
  expect(result.snapshots[0]?.state.agents.map((a) => a.provider)).toEqual(['echo']);
});

it('refuses a provider nobody registered', async () => {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo' })] });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'p', protocolVersions: ['0.9.0'] } });
  await expect(client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/x', provider: 'claude' },
  })).rejects.toMatchObject({ code: -32002 });
});

it('offers the backend\'s own settings, and not another\'s', async () => {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo' })] });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'p', protocolVersions: ['0.9.0'] } });
  const config = await client.handle({
    method: 'resolveSessionConfig',
    params: { channel: 'ahp-root://', provider: 'echo' },
  }) as { schema: { properties: Record<string, unknown> }; values: Record<string, string> };
  // Claude's permission mode and effort are Claude's. A host that offered
  // them here would be offering controls this backend has never heard of.
  // The permission rules and the sensitive edit locations are this host's, on
  // every session.
  expect(Object.keys(config.schema.properties)).toEqual(['permissions', 'sensitiveEditLocations', 'voice']);
  expect(config.values).toEqual({ voice: 'plain' });
});

it('carries a turn from the client to the backend and back', async () => {
  const { client, peer: p, chatUri } = await talking();
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello there' } } },
  });
  await settle(12);

  const said = actions(p, chatUri).map((e) => e.action.type);
  // The order every backend has to keep: the turn is said back, a part is
  // opened, and only then does text stream into it. Their order relative to
  // each other, not their position - a backend may say other things in
  // between, and this one says what it is doing.
  const ordering = said.filter((type) => type === 'chat/turnStarted'
    || type === 'chat/responsePart'
    || type === 'chat/delta');
  expect(ordering.slice(0, 3)).toEqual(['chat/turnStarted', 'chat/responsePart', 'chat/delta']);
  expect(said).toContain('chat/turnComplete');

  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { content: string }[] }[] } };
  };
  expect(opened.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('hello there');
});

it('says it back in the voice the session was created with', async () => {
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo', pace: 0 })] });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'p', protocolVersions: ['0.9.0'] } });
  await client.handle({
    method: 'createSession',
    params: { channel: 'ahp-session:/two', provider: 'echo', config: { voice: 'shouty' } },
  });
  const two = ((await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/two' } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  client.handle({
    method: 'dispatchAction',
    params: { channel: two, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } },
  });
  await settle(12);
  const opened = await client.handle({ method: 'subscribe', params: { channel: two } }) as {
    snapshot: { state: { turns: { responseParts: { content: string }[] }[] } };
  };
  expect(opened.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('HELLO');
});

/*
 * A host started again over the same store lists the session it ran, and
 * opens it from the backend's transcript. The example keeps its transcripts in
 * memory, so the second host is handed the same backend.
 */
it('leaves a finished session in the catalogue, and opens it again from its transcript', async () => {
  const sessions = memorySessions();
  const agent = echo({ path: '/tmp/echo', pace: 0 });
  const first = createHost({ path: '/tmp/echo', agents: [agent], sessions }).accept(peer());
  await first.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  const uri = 'ahp-session:/one';
  await first.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  const chatUri = ((await first.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  first.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'remember me' } } },
  });
  await settle(12);

  const client = createHost({ path: '/tmp/echo', agents: [agent], sessions }).accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; provider: string; title: string }[];
  };
  expect(listed.items).toHaveLength(1);
  expect(listed.items[0]).toMatchObject({ provider: 'echo', title: 'remember me' });

  // Opened from its transcript, with nothing started: this is what makes a
  // catalogue row a row somebody can read.
  const row = listed.items[0]?.resource ?? '';
  const chat = ((await client.handle({ method: 'subscribe', params: { channel: row } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  const again = await client.handle({ method: 'subscribe', params: { channel: chat } }) as { snapshot: { state: { turns: unknown[] } } };
  expect(again.snapshot.state.turns).toHaveLength(1);
});

/*
 * A finished turn carries its state, as the protocol's `Turn` requires, and a
 * first message titles the session as VS Code's host seeds a title:
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionTitleController.ts#L252-L255
 */
it('keeps a finished turn complete, and titles the session from its first message as VS Code seeds one', async () => {
  const { client, uri, chatUri } = await talking();
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '  hello\n\tthere  ' } } },
  });
  await settle(12);
  const chat = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { state?: string }[] } };
  };
  expect(chat.snapshot.state.turns[0]?.state).toBe('complete');
  const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { title: string } };
  };
  expect(session.snapshot.state.title).toBe('hello there');
});

// The slash command the probe offers is run, as VS Code's providers run theirs.
it('runs the slash command it offers: /shout says the rest of its line loudly', async () => {
  const { client, chatUri } = await talking();
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: '/shout hello there' } } },
  });
  await settle(12);
  const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
    snapshot: { state: { turns: { responseParts: { content: string }[] }[] } };
  };
  expect(opened.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('HELLO THERE');
});

// A row carries the moment its session began and the folder it worked in, as VS Code lists a session.
it('lists a finished session with the moment it began and the folder it worked in', async () => {
  // A folder that is there, since a row naming a folder that is gone is listed without it.
  const folder = mkdtempSync(join(tmpdir(), 'echo-row-'));
  const host = createHost({ path: '/tmp/echo', agents: [echo({ path: '/tmp/echo', pace: 0 })] });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'p', protocolVersions: ['0.9.0'] } });
  const uri = 'ahp-session:/three';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', workingDirectories: [pathToFileURL(folder).href] } });
  // The default chat the host minted for the session.
  const chat = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  // Long enough that the session's start and its turn's end are two moments.
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'remember me' } } },
  });
  await settle(12);
  await client.handle({ method: 'disposeSession', params: { channel: uri } });
  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { createdAt: string; modifiedAt: string; workingDirectories?: string[] }[];
  };
  const row = listed.items[0];
  rmSync(folder, { recursive: true, force: true });
  expect(Date.parse(row?.createdAt ?? '')).toBeLessThan(Date.parse(row?.modifiedAt ?? ''));
  expect(row?.workingDirectories).toEqual([pathToFileURL(folder).href]);
});

it('will not take two backends that call themselves the same thing', () => {
  expect(() => createHost({
    path: '/tmp/echo',
    agents: [echo({ path: '/tmp/echo' }), echo({ path: '/tmp/other' })],
  })).toThrow(/echo/);
});
