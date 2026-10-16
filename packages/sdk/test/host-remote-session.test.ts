/*
 * A session a window sent here.
 *
 * A window hands a session to another host by naming where it came from on the
 * create request, under its own keys in the request's `_meta` bag - VS Code
 * 1.141 sends them there, beside an empty config. The host also takes them
 * in the config's `_meta`, which is how its own roads hand them on. What is
 * checked here is that such a session is taken, that the origin survives the
 * trip to the session's summary and a restart, that a value the window could
 * not have written is no origin rather than half of one, and that the agent
 * working it is told to report back - which it is only where a client in the
 * session offers the tool the telling names, and only on the turns that begin
 * while that client is there.
 *
 * `remotesession.ts` is where the keys and the reader live, so the first
 * describe reads it directly and the rest drive a host through it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asCreatedBy, asOrigin, depthOf, readOrigin } from '../src/remotesession.js';
import { fileSessions } from '../src/sessions.js';
import type { HostOptions } from '../src/types/host.js';
import {
  claude, createHost, emit, hello, machine, peer, resetSdk, sdk, sessionQueries, settle,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

const ORIGIN = 'vscode.remoteSession.origin';
const DEPTH = 'agentHost/sessionSpawnDepth';
const CREATED_BY = 'agentHost/createdBySession';

/** A chat session as the window that delegates work spells one. */
const FROM = 'agent-host-claude:/sent-from';
const CHAT = `${FROM}#chat`;
/** The session channel a client makes, and the name this host lists it under. */
const SESSION = 'ahp-session:/sent';
const NAMED = 'claude:/sent';

/**
 * The window's own words to the agent, as its contribution writes them.
 *
 * Written out here rather than read from the host, because what is being
 * checked is that this is the text - a copy on both sides of the assertion
 * would pass whatever either of them said.
 */
const REPORT_BACK = `<remote_session_origin>
For each delegated task from the origin, including follow-ups, send results, blockers, or questions to the exact originating chat using send_remote_message with session "origin" before ending your turn, unless explicitly told not to report back. Final answers are not forwarded.
Load send_remote_message with tool search if needed.
Only claim delivery after "sent" or "queued"; report failures here. Do not retry uncertain delivery.
Do not acknowledge messages with no new task or question. Continue independent work or end your turn; do not sleep or poll for replies.
</remote_session_origin>`;
/** The tool that text tells the agent to call, which is what a client has to offer. */
const REPORTS_BACK = { name: 'send_remote_message' };

describe('reading where a session came from', () => {
  it('reads the origin the window wrote, and keeps it as it was written', () => {
    expect(readOrigin({ _meta: { [ORIGIN]: { session: FROM, chat: CHAT, depth: 2 } } }))
      .toEqual({ session: FROM, chat: CHAT, depth: 2 });
    // The session itself is the chat the window named none for: what an agent
    // is told to report back to is one chat, and a session is the one it is.
    expect(readOrigin({ _meta: { [ORIGIN]: { session: FROM, chat: FROM, depth: 0 } } }))
      .toEqual({ session: FROM, chat: FROM, depth: 0 });
    // A session reached over the network is named under the other prefix.
    expect(readOrigin({ _meta: { [ORIGIN]: { session: 'remote-ssh-claude:/there', chat: 'remote-ssh-claude:/there', depth: 1 } } })?.session)
      .toBe('remote-ssh-claude:/there');
  });

  it('is no origin at all where any part of it is not one', () => {
    // Each row is a value the window could not have written, and each is named
    // for the reason it is refused rather than listed as one blob: this reader
    // is the window's host's own, and half an origin is worse than none.
    const wrong: [string, unknown][] = [
      ['not an object', FROM],
      ['a list', []],
      ['no chat', { session: FROM, depth: 0 }],
      ['a depth that is not a whole number', { session: FROM, chat: CHAT, depth: 1.5 }],
      ['a depth below none', { session: FROM, chat: CHAT, depth: -1 }],
      ['a depth that is not a number', { session: FROM, chat: CHAT, depth: '2' }],
      ['a session under a scheme that names no host', { session: 'claude:/one', chat: 'claude:/one', depth: 0 }],
      ['the bare local prefix', { session: 'agent-host-:/one', chat: 'agent-host-:/one', depth: 0 }],
      ['an authority', { session: 'agent-host-claude://host/one', chat: 'agent-host-claude://host/one', depth: 0 }],
      ['no path at all', { session: 'agent-host-claude:/', chat: 'agent-host-claude:/', depth: 0 }],
      ['a query', { session: 'agent-host-claude:/one?x', chat: 'agent-host-claude:/one?x', depth: 0 }],
      ['a chat that is no chat of that session', { session: FROM, chat: 'agent-host-claude:/other#chat', depth: 0 }],
    ];
    for (const [why, value] of wrong) {
      expect(asOrigin(value), why).toBeUndefined();
    }
    // And the whole of it goes, not only the part that is wrong - so a config
    // carrying one is a session with no origin rather than one with half.
    expect(readOrigin({ _meta: { [ORIGIN]: { session: FROM, chat: CHAT, depth: -1 } } })).toBeUndefined();
    // Nothing to read is not a refusal: a config with no bag is every session
    // this host began itself.
    expect(readOrigin({})).toBeUndefined();
    expect(readOrigin(undefined)).toBeUndefined();
  });

  it('counts from the deeper of the depth held and the one the origin came with', () => {
    // The window's own arithmetic, so a session sent on from here is that much
    // further from the one that began the work.
    expect(depthOf(undefined, { session: FROM, chat: CHAT, depth: 2 })).toBe(2);
    expect(depthOf({ [DEPTH]: 5 }, { session: FROM, chat: CHAT, depth: 2 })).toBe(5);
    expect(depthOf({ [DEPTH]: 1 }, { session: FROM, chat: CHAT, depth: 4 })).toBe(4);
    expect(depthOf({ [DEPTH]: 'deep' }, { session: FROM, chat: CHAT, depth: 3 })).toBe(3);
  });

  it('reads a creator that names a session, and keeps what else it named', () => {
    expect(asCreatedBy({ session: 'abc' })).toEqual({ session: 'abc' });
    expect(asCreatedBy({ session: 'abc', chat: 'abc#one', turnId: 't1' }))
      .toEqual({ session: 'abc', chat: 'abc#one', turnId: 't1' });
    // A reference and not an address: nothing is reported back to it, so the
    // id alone is what makes one - which is what the window's reader asks for
    // and no more.
    expect(asCreatedBy({ chat: 'abc#one' })).toBeUndefined();
    expect(asCreatedBy('abc')).toBeUndefined();
    expect(asCreatedBy({ session: 7 })).toBeUndefined();
  });
});

/**
 * One host, one client, and a session it made with what was given.
 *
 * `active` is announced with the session rather than after it, which is the
 * protocol's own shortcut and how a window that delegates work arrives: one
 * request, carrying what it can run.
 */
const made = async (
  config?: Record<string, unknown>,
  over: Partial<HostOptions> = {},
  active?: { tools: { name: string }[] },
  meta?: Record<string, unknown>,
) => {
  const host = createHost({
    path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), ...over,
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
  await client.handle({
    method: 'createSession',
    params: {
      channel: SESSION,
      provider: 'claude',
      ...(config === undefined ? {} : { config }),
      ...(active === undefined ? {} : { activeClient: active }),
      ...(meta === undefined ? {} : { _meta: meta }),
    },
  });
  await settle();
  const state = (await client.handle({ method: 'subscribe', params: { channel: SESSION } }) as {
    snapshot: { state: { _meta?: Record<string, unknown>; defaultChat: string } };
  }).snapshot.state;
  const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; _meta?: Record<string, unknown> }[];
  };
  // The chat as the session itself named it, rather than a spelling of this
  // test's: a message goes to a chat channel, and that is the one it is.
  return { client, peer: p, chat: state.defaultChat, meta: state._meta, row: listed.items.find((one) => one.resource === NAMED) };
};

/** What the window writes on a create request that sends a session here. */
const sent = {
  _meta: {
    [ORIGIN]: { session: FROM, chat: CHAT, depth: 2 },
    [CREATED_BY]: { session: 'abc', chat: 'abc#one', turnId: 't1' },
  },
};

describe('a session a window sent here', () => {

  it('keeps the origin, the session that made it and how deep it is', async () => {
    const { meta, row } = await made(sent);
    // The window's own keys, word for word: it reads the origin back off the
    // state and off the row, and a key it does not know is one it never sees.
    expect(meta?.[ORIGIN]).toEqual({ session: FROM, chat: CHAT, depth: 2 });
    expect(meta?.[DEPTH]).toBe(2);
    expect(meta?.[CREATED_BY]).toEqual({ session: 'abc', chat: 'abc#one', turnId: 't1' });
    // And on the row, which is what a window listing sessions draws - the same
    // three, from the same place, so the two cannot disagree.
    expect(row?._meta?.[ORIGIN]).toEqual({ session: FROM, chat: CHAT, depth: 2 });
    expect(row?._meta?.[DEPTH]).toBe(2);
    expect(row?._meta?.[CREATED_BY]).toEqual({ session: 'abc', chat: 'abc#one', turnId: 't1' });
  });

  it('takes the origin on the request\'s own _meta, where VS Code sends it', async () => {
    // As the 1.141 window sent it: the keys beside an empty config, not in it.
    const { meta, row } = await made({}, {}, undefined, sent._meta);
    expect(meta?.[ORIGIN]).toEqual({ session: FROM, chat: CHAT, depth: 2 });
    expect(meta?.[DEPTH]).toBe(2);
    expect(meta?.[CREATED_BY]).toEqual({ session: 'abc', chat: 'abc#one', turnId: 't1' });
    expect(row?._meta?.[ORIGIN]).toEqual({ session: FROM, chat: CHAT, depth: 2 });
  });

  it('has none of the three for a session this host began itself', async () => {
    const { meta } = await made();
    expect(meta?.[ORIGIN]).toBeUndefined();
    expect(meta?.[DEPTH]).toBeUndefined();
    expect(meta?.[CREATED_BY]).toBeUndefined();
  });

  it('makes the session anyway where the origin is not one, and keeps none of it', async () => {
    const { meta, row } = await made({
      _meta: { [ORIGIN]: { session: 'not-a-session-at-all', chat: 'not-a-session-at-all', depth: 0 } },
    });
    // The window's host drops a malformed origin rather than refusing the
    // session, and this host does the same: the ask was for a session, and a
    // session that reports back nowhere beats one that was never made.
    expect(row).toBeDefined();
    expect(row?._meta?.[ORIGIN]).toBeUndefined();
    expect(meta?.[ORIGIN]).toBeUndefined();
    expect(meta?.[DEPTH]).toBeUndefined();
  });

  it('brings all three back after a restart on the same store', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-remote-session-'));
    try {
      const dir = join(root, 'sessions');
      const first = createHost({
        path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), sessions: fileSessions({ dir }),
      });
      const a = first.accept(peer());
      await a.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
      await a.handle({ method: 'createSession', params: { channel: SESSION, provider: 'claude', config: sent } });
      await settle();
      // The write is coalesced onto the next tick.
      await new Promise((tick) => { setTimeout(tick, 5); });

      /*
       * A second host on the same store, which is what a restart is. The name
       * is opened again with no config, which is what a session read back out
       * of the store looks like - and the origin that comes back is the one
       * the first host wrote down rather than one this one was told.
       */
      const second = createHost({
        path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })], ...machine(), sessions: fileSessions({ dir }),
      });
      const b = second.accept(peer());
      await b.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
      await b.handle({ method: 'createSession', params: { channel: SESSION, provider: 'claude' } });
      await settle();
      const state = (await b.handle({ method: 'subscribe', params: { channel: SESSION } }) as {
        snapshot: { state: { _meta?: Record<string, unknown> } };
      }).snapshot.state;
      expect(state._meta?.[ORIGIN]).toEqual({ session: FROM, chat: CHAT, depth: 2 });
      expect(state._meta?.[DEPTH]).toBe(2);
      expect(state._meta?.[CREATED_BY]).toEqual({ session: 'abc', chat: 'abc#one', turnId: 't1' });
    }
    finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** What the session's backend was started with, which is where a host's instruction lands. */
const started = () => (sessionQueries()[0]?.options.systemPrompt) as
  { type: string; preset: string; append: string; snapshot: boolean } | undefined;

/**
 * What the CLI would be told beside the prompt of the turn now running.
 *
 * Read off the `UserPromptSubmit` hooks the query was built with, which is the
 * only door a host has to the model that is not the message itself - and the
 * same door the CLI knocks on, run the same way, so what this returns is what
 * the model is given.
 */
const told = async (): Promise<string[]> => {
  type HookOut = { hookSpecificOutput?: { additionalContext?: string } };
  const hooks = sessionQueries()[0]?.options.hooks as
    { UserPromptSubmit?: { hooks: ((input: Record<string, unknown>) => Promise<HookOut>)[] }[] } | undefined;
  const said: string[] = [];
  for (const group of hooks?.UserPromptSubmit ?? []) {
    for (const hook of group.hooks) {
      const context = (await hook({ hook_event_name: 'UserPromptSubmit', prompt: 'anything' }))
        .hookSpecificOutput?.additionalContext;
      if (typeof context === 'string') said.push(context);
    }
  }
  return said;
};

/** A client that can be sent actions, which is all these cases need of one. */
type Client = { handle(request: { method: string; params: Record<string, unknown> }): Promise<unknown> };

/** A turn of a chat, as a client sends one - the queued spelling when `waiting` names it. */
const says = (client: Client, chat: string, text: string, waiting?: string) => client.handle({
  method: 'dispatchAction',
  params: {
    channel: chat,
    action: waiting === undefined
      ? { type: 'chat/turnStarted', turnId: crypto.randomUUID(), message: { text } }
      : { type: 'chat/pendingMessageSet', kind: 'queued', id: waiting, message: { text } },
  },
});

/** A client announcing itself into a session, with the tool the instruction names. */
const announces = (client: Client) => client.handle({
  method: 'dispatchAction',
  params: {
    channel: SESSION,
    action: { type: 'session/activeClientSet', activeClient: { tools: [REPORTS_BACK] } },
  },
});

describe('telling each turn of a session another window sent here to report back', () => {
  it('gives nothing at the start, and gives it to the turn that begins while a client can report', async () => {
    const { client, chat } = await made(sent);
    // Nothing where a client that can report has not arrived: the text names a
    // tool, so a session where the model has not got it is one where the agent
    // would be told to call something it cannot.
    expect(started()).toBeUndefined();
    await says(client, chat, 'first');
    await settle();
    // Running, so what is read below is the turn's own: the CLI has the words
    // the person sent and nothing beside them.
    expect(sdk.said).toContain('first');
    expect(await told()).toEqual([]);

    // A window joining a session already running, which is the case a
    // create-time instruction could not reach.
    await announces(client);
    // Not this turn: it was told what was true when it began.
    expect(await told()).toEqual([]);

    // A message that waits its turn, and the turn that comes to it.
    await says(client, chat, 'second', 'waiting-1');
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 3 });
    expect(await told()).toEqual([REPORT_BACK]);
  });

  it('tells the first turn to report back when the window sent the origin on the request', async () => {
    // The 1.141 window's create request: origin on the request's `_meta`, and
    // the creator announced in the same request with the tool it reports with.
    const { client, chat } = await made({}, {}, { tools: [REPORTS_BACK] }, sent._meta);
    await says(client, chat, 'list the files');
    await settle();
    expect(await told()).toEqual([REPORT_BACK]);
  });

  it('gives none to a turn that begins after the client that could report has gone', async () => {
    const { client, chat } = await made(sent, {}, { tools: [REPORTS_BACK] });
    // Nothing at start even here, where a client able to report was in the
    // session from its first moment: the words belong to a turn, not to a
    // session, so the backend is started without them either way.
    expect(started()).toBeUndefined();
    await says(client, chat, 'first');
    expect(await told()).toEqual([REPORT_BACK]);
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 3 });

    await client.handle({ method: 'unsubscribe', params: { channel: SESSION } });
    await says(client, chat, 'second');
    expect(await told()).toEqual([]);
  });

  it('gives none to a session this host began itself', async () => {
    const { client, chat } = await made(undefined, {}, { tools: [REPORTS_BACK] });
    // A client that can report is not enough on its own: there is nowhere for
    // this session's agent to report back to.
    await says(client, chat, 'first');
    expect(await told()).toEqual([]);
  });

  it('gives none to a session whose clients offer some other tool', async () => {
    const { client, chat } = await made(sent, {}, { tools: [{ name: 'openBrowserPage' }, { name: 'send_remote_message_v2' }] });
    await says(client, chat, 'first');
    expect(await told()).toEqual([]);
  });
});
