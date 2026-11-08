import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@microsoft/agent-host-protocol';
import type { Adapter, AgentView, Bag, Connector, ConnectorOwner, Engine, MessageAttachment, PluginHost, Start } from '@ahpd/sdk';
import { startedNow } from '../../sdk/test/support/started.js';

/*
 * One Claude agent on several logins, as the model proxy routes a name over
 * its entries.
 *
 * A record's `logins` names connectors of `claude-login`, each one account's
 * token, in the order they are tried. A turn runs on the first ready one, and
 * the CLI reads its token as `CLAUDE_CODE_OAUTH_TOKEN`. A record that names
 * none runs on the agent's own credential.
 */

/** Every CLI a session started, with the options it was given and a queue of the frames it sends. */
const sdk = vi.hoisted(() => {
  interface Fake { options: Record<string, unknown>; held: Record<string, unknown>[]; wake: (() => void) | undefined; closed: boolean }
  const state = {
    queries: [] as Fake[],
    /** Each prompt a CLI read, with the uuid it carried and the CLI that read it. */
    said: [] as { content: unknown; uuid: string | undefined; query: number }[],
    /** Every conversation the SDK deleted. */
    deleted: [] as string[],
    /** The conversations whose delete fails. */
    undeletable: new Set<string>(),
    /** Whether a closed CLI's frames end by raising, as a close may, rather than by ending. */
    raising: false,
    reset() {
      state.queries.length = 0;
      state.said.length = 0;
      state.deleted.length = 0;
      state.undeletable.clear();
      state.raising = false;
    },
    /** Frames from the CLI started last. */
    push(...frames: Record<string, unknown>[]) {
      const fake = state.queries.at(-1);
      if (fake === undefined) throw new Error('no CLI was started');
      fake.held.push(...frames);
      fake.wake?.();
      fake.wake = undefined;
    },
  };
  return state;
});

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  deleteSession: async (id: string) => {
    if (sdk.undeletable.has(id)) throw new Error(`EACCES: permission denied, unlink '${id}.jsonl'`);
    sdk.deleted.push(id);
  },
  // The SDK's read of one session: a conversation a case resumes is one it holds.
  getSessionInfo: async (id: string) => ({ sessionId: id }),
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    const fake = { options, held: [] as Record<string, unknown>[], wake: undefined as (() => void) | undefined, closed: false };
    const index = sdk.queries.push(fake) - 1;
    // Read at once, as the SDK reads its input, so a prompt reaches the CLI started last.
    void (async () => {
      for await (const frame of prompt) {
        const { message, uuid } = frame as { message?: { content?: unknown }; uuid?: string };
        sdk.said.push({ content: message?.content, uuid, query: index });
      }
    })();
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (fake.held.length > 0) yield fake.held.shift() as Record<string, unknown>;
          if (fake.closed && sdk.raising) throw new Error('The operation was aborted');
          if (fake.closed) return;
          await new Promise<void>((resolve) => { fake.wake = resolve; });
        }
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: async () => {},
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => { fake.closed = true; fake.wake?.(); },
      // The SDK's close ends the frames at once, and its dispose settles once
      // the CLI's process has exited, a moment later.
      [Symbol.asyncDispose]: async () => {
        fake.closed = true;
        fake.wake?.();
        await new Promise((r) => { setTimeout(r, 20); });
      },
    };
  },
}));

/** What the blocks of a message with attachments wait for, while it is set. */
const blocks = vi.hoisted(() => ({ gate: undefined as Promise<void> | undefined }));

vi.mock('../src/session/attachments.js', async (original) => {
  const real = await original<typeof import('../src/session/attachments.js')>();
  return {
    ...real,
    blocksFor: async (...args: Parameters<typeof real.blocksFor>) => {
      if (args[1] !== undefined && args[1].length > 0) await blocks.gate;
      return await real.blocksFor(...args);
    },
  };
});

const { createSession } = await import('../src/session.js');
const { OpenLogins } = await import('../src/logins.js');
type Logins = InstanceType<typeof OpenLogins>;

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Wait for `done` to hold, for three seconds at most, and then for what follows from it. */
const until = async (done: () => boolean): Promise<void> => {
  for (let i = 0; i < 300 && !done(); i++) await new Promise((r) => { setTimeout(r, 10); });
  await settle();
  if (!done()) throw new Error('still waiting');
};

beforeEach(() => {
  sdk.reset();
  blocks.gate = undefined;
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
});

/** One open login of `claude-login`, as the adapter's `open` keeps it; the answer closes it. */
const opened = (logins: Logins, id: string, token: string, owner: ConnectorOwner = 'host'): (() => void) =>
  logins.opened({ id, adapter: 'claude-login', owner, config: { token } });

/** The host's two logins, open. */
const twoLogins = (): Logins => {
  const logins = new OpenLogins();
  opened(logins, 'personal', 'token-personal');
  opened(logins, 'work', 'token-work');
  return logins;
};

/** A session of a record with these values, on one chat, of an agent the owner holds. */
const open = (preset: Bag, logins: Logins, extra: Record<string, unknown> = {}, owner: ConnectorOwner = 'host') => {
  const chat: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/logins',
    chatUri: 'ahp-chat:/logins',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-logins-')),
    emit: (channel, action) => { if (channel === 'chat') chat.push(action as Bag); },
    preset,
    logins: { open: logins, owner: () => owner },
    ...extra,
  });
  return { session, chat };
};

/** A session as `open` makes it, whose first send started its CLI. */
const started = (...args: Parameters<typeof open>): ReturnType<typeof open> => {
  const made = open(...args);
  made.session.sendMessage('t0', 'hello');
  return made;
};

/** The environment the CLI started `at` (the last by default) was given, when it was given one. */
const envOf = (at = -1): Bag | undefined => sdk.queries.at(at)?.options.env as Bag | undefined;

/** The token the CLI started `at` signs in with. */
const tokenOf = (at = -1): unknown => envOf(at)?.['CLAUDE_CODE_OAUTH_TOKEN'];

/** A turn the CLI answered and ended, as its frames come. */
const answered = (id: string) => [
  { type: 'assistant', parent_tool_use_id: null, uuid: `end-${id}`, session_id: 'cli-1', message: { id: `msg-${id}`, role: 'assistant', model: 'claude-x', content: [{ type: 'text', text: `answer ${id}` }] } },
  { type: 'result', subtype: 'success', is_error: false, session_id: 'cli-1', duration_ms: 5 },
];

/** The CLI's answer to the prompt it was sent under `uuid`, its frames naming that prompt as SDK 0.3.301's do. */
const answeredFor = (uuid: string, text: string) => [
  {
    type: 'assistant', parent_tool_use_id: null, uuid: `end-${uuid}`, session_id: 'cli-1', user_message_uuid: uuid,
    message: { id: `msg-${uuid}`, role: 'assistant', model: 'claude-x', content: [{ type: 'text', text }] },
  },
  { type: 'result', subtype: 'success', is_error: false, session_id: 'cli-1', duration_ms: 5, user_message_uuids: [uuid] },
];

/** The actions a chat was sent of one type, for one turn. */
const ofTurn = (chat: Bag[], type: string, turnId: string): Bag[] =>
  chat.filter((action) => action.type === type && action.turnId === turnId);

/** Run one turn to its answer. */
const turn = async (session: { sendMessage: (id: string, text: string) => unknown }, id: string, text: string): Promise<void> => {
  session.sendMessage(id, text);
  await settle();
  sdk.push(...answered(id));
  await settle();
};

describe("a turn's login", () => {
  it("starts the CLI on the record's first login, with its token", async () => {
    started({ logins: ['personal', 'work'] }, twoLogins());
    await settle();
    expect(tokenOf()).toBe('token-personal');
    started({ logins: ['work', 'personal'] }, twoLogins());
    await settle();
    expect(tokenOf()).toBe('token-work');
  });

  it("tells the CLI the profile scopes of a login whose profile answered, and none of one whose did not", async () => {
    const logins = twoLogins();
    logins.profiled('work', 'token-work', { email: 'someone@example.com', plan: 'max' });
    // A profile of a token the login no longer holds says nothing.
    logins.profiled('personal', 'token-old', { plan: 'pro' });
    process.env.CLAUDE_CODE_OAUTH_SCOPES = 'user:inference user:everything';
    try {
      open({ logins: ['work'] }, logins);
      await settle();
      expect(tokenOf()).toBe('token-work');
      expect(envOf()?.['CLAUDE_CODE_OAUTH_SCOPES']).toBe('user:profile user:inference');
      open({ logins: ['personal'] }, logins);
      await settle();
      expect(tokenOf()).toBe('token-personal');
      // The daemon's own value never reaches a CLI on a login.
      expect(envOf()).not.toHaveProperty('CLAUDE_CODE_OAUTH_SCOPES');
    }
    finally {
      delete process.env.CLAUDE_CODE_OAUTH_SCOPES;
    }
  });

  it("takes the next login in the record's order when the first is not open", async () => {
    started({ logins: ['gone', 'work', 'personal'] }, twoLogins());
    await settle();
    expect(tokenOf()).toBe('token-work');
  });

  it('sets no token for a record that names no login', async () => {
    for (const preset of [{}, { logins: [] }]) {
      started(preset, twoLogins());
      await settle();
      expect(tokenOf(), JSON.stringify(preset)).toBeUndefined();
    }
  });

  it('refuses a turn whose record names logins and has none open, and names each one', async () => {
    const { session, chat } = open({ logins: ['gone', 'away'] }, twoLogins());
    await settle();
    session.sendMessage('t1', 'one');
    await settle();
    const failed = ofTurn(chat, 'chat/error', 't1');
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed[0])).toContain('No login this agent names is open: gone, away');
    expect(sdk.said).toEqual([]);
  });

  it("skips another person's login and takes the host's", async () => {
    const logins = new OpenLogins();
    opened(logins, 'ana-login', 'token-ana', 'user:ana');
    opened(logins, 'cy-login', 'token-cy', 'user:cy');
    opened(logins, 'host-login', 'token-host');
    started({ logins: ['ana-login', 'host-login'] }, logins, {}, 'user:cy');
    await settle();
    expect(tokenOf()).toBe('token-host');
    started({ logins: ['ana-login', 'cy-login', 'host-login'] }, logins, {}, 'user:cy');
    await settle();
    expect(tokenOf()).toBe('token-cy');
  });

  it("gives a CLI on a login no key and no cloud switch from the record's env or the daemon's", async () => {
    started({
      logins: ['work'],
      env: { ANTHROPIC_API_KEY: 'key', ANTHROPIC_AUTH_TOKEN: 'bearer', CLAUDE_CODE_USE_BEDROCK: '1', ANTHROPIC_BASE_URL: 'https://example.invalid' },
    }, twoLogins());
    await settle();
    expect(tokenOf()).toBe('token-work');
    for (const variable of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK']) expect(envOf()?.[variable], variable).toBeUndefined();
    expect(envOf()?.['ANTHROPIC_BASE_URL']).toBe('https://example.invalid');

    const before = process.env.CLAUDE_CODE_USE_VERTEX;
    process.env.CLAUDE_CODE_USE_VERTEX = '1';
    try {
      started({ logins: ['work'] }, twoLogins());
      await settle();
      expect(tokenOf()).toBe('token-work');
      expect(envOf()?.['CLAUDE_CODE_USE_VERTEX']).toBeUndefined();
    }
    finally {
      if (before === undefined) delete process.env.CLAUDE_CODE_USE_VERTEX;
      else process.env.CLAUDE_CODE_USE_VERTEX = before;
    }
  });

  it('runs a session a client pushed a key for on the key, and on no login', async () => {
    started({ logins: ['personal', 'work'] }, twoLogins(), { env: { ANTHROPIC_API_KEY: 'pushed' } });
    await settle();
    expect(tokenOf()).toBeUndefined();
    expect(envOf()?.['ANTHROPIC_API_KEY']).toBe('pushed');
  });

  it("lays the login's token over the record's env", async () => {
    started({ logins: ['work'], env: { CLAUDE_CODE_OAUTH_TOKEN: 'the-record-s', ANTHROPIC_BASE_URL: 'https://example.invalid' } }, twoLogins());
    await settle();
    expect(tokenOf()).toBe('token-work');
    expect(envOf()?.['ANTHROPIC_BASE_URL']).toBe('https://example.invalid');
  });

  it('moves the next turn to a new CLI on the next login when its login closes, and back once it opens again', async () => {
    const logins = new OpenLogins();
    const close = opened(logins, 'personal', 'token-personal');
    opened(logins, 'work', 'token-work');
    const { session } = open({ logins: ['personal', 'work'] }, logins);
    await settle();
    await turn(session, 't1', 'one');
    await turn(session, 't2', 'two');
    // The same CLI answers the second turn: nothing moved.
    expect(sdk.queries).toHaveLength(1);

    close();
    session.sendMessage('t3', 'three');
    await settle();
    expect(sdk.queries).toHaveLength(2);
    expect(tokenOf()).toBe('token-work');
    // Resumed into the conversation the first CLI named.
    expect(sdk.queries.at(-1)?.options.resume).toBe('cli-1');
    expect(sdk.said.at(-1)).toMatchObject({ content: 'three', query: 1 });
    sdk.push(...answered('t3'));
    await settle();

    opened(logins, 'personal', 'token-personal');
    session.sendMessage('t4', 'four');
    await settle();
    expect(sdk.queries).toHaveLength(3);
    expect(tokenOf()).toBe('token-personal');
    expect(sdk.said.at(-1)).toMatchObject({ content: 'four', query: 2 });
  });

  it("moves the next turn to a new CLI when a put replaces its login's token", async () => {
    const logins = twoLogins();
    const { session } = open({ logins: ['work', 'personal'] }, logins);
    await settle();
    await turn(session, 't1', 'one');

    // A put closes the connector and opens it again with the new token.
    opened(logins, 'work', 'token-work-again');
    session.sendMessage('t2', 'two');
    await settle();
    expect(sdk.queries).toHaveLength(2);
    expect(tokenOf()).toBe('token-work-again');
  });

  it("moves the next turn when an edit names other logins, and to the agent's own credential when it names none", async () => {
    const logins = twoLogins();
    let values: Bag = { logins: ['personal', 'work'] };
    const { session } = open({}, logins, { presetOf: () => values });
    await settle();
    await turn(session, 't1', 'one');
    expect(tokenOf()).toBe('token-personal');

    values = { logins: ['work'] };
    session.sendMessage('t2', 'two');
    await settle();
    expect(sdk.queries).toHaveLength(2);
    expect(tokenOf()).toBe('token-work');
    sdk.push(...answered('t2'));
    await settle();

    values = { logins: [] };
    session.sendMessage('t3', 'three');
    await settle();
    expect(sdk.queries).toHaveLength(3);
    expect(tokenOf()).toBeUndefined();
  });

  it("runs a record's logins from the load's open connectors, through the plugin's engine", async () => {
    const { apply } = await import('../src/plugin.js');
    const engines: Engine[] = [];
    const adapters: { name: string; open: (connector: unknown) => unknown }[] = [];
    const host = {
      paths: [mkdtempSync(join(tmpdir(), 'ahpd-logins-plugin-'))],
      log: () => {},
      registerAdapter: (adapter: { name: string; open: (connector: unknown) => unknown }) => { adapters.push(adapter); },
      registerEngine: (engine: Engine) => { engines.push(engine); },
    } as unknown as PluginHost;
    await apply(host, {});
    const adapter = adapters.find((one) => one.name === 'claude-login');
    const engine = engines.find((one) => one.name === 'claude');
    if (adapter === undefined || engine === undefined) throw new Error('the plugin registered no claude-login adapter or claude engine');
    adapter.open({ id: 'work', adapter: 'claude-login', owner: 'host', config: { token: 'token-work' } });

    const view: AgentView = {
      id: 'claude-logins', engine: 'claude', owner: 'host', name: 'Logins',
      description: undefined, icon: undefined, model: undefined, config: { logins: ['work'] },
    };
    const start: Start = {
      uri: 'ahp-session:/claude-logins', chatUri: 'ahp-chat:/claude-logins', settings: {}, clientToolTimeoutMs: 60_000,
      schema: () => ({ type: 'object', properties: {} }),
      emit: () => {},
      workingDirectory: (host as unknown as { paths: string[] }).paths[0] as string,
    };
    startedNow(engine.open(view).create(start)).sendMessage('t1', 'hello');
    await settle();
    expect(tokenOf()).toBe('token-work');
  });
});

/*
 * A failed login hands the turn on, as the model proxy hands a call to its
 * next entry.
 *
 * The frames below are the ones a real CLI on SDK 0.3.301 sent once it gave up
 * on a request: for a claude.ai login's 429, the SDK's `rate_limit_event`
 * first; then a synthetic assistant frame carrying `error`; then a `result`
 * with `is_error`.
 */
const SPENT = "You've hit your session limit · resets 5pm";
const failure = (error: string, said = SPENT, resetsAt?: number) => [
  ...(resetsAt === undefined ? [] : [{
    type: 'rate_limit_event', session_id: 'cli-1',
    rate_limit_info: { status: 'rejected', resetsAt, rateLimitType: 'five_hour' },
  }]),
  {
    type: 'assistant', parent_tool_use_id: null, uuid: `failed-${error}`, session_id: 'cli-1', error,
    message: { id: 'msg-failed', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: said }] },
  },
  { type: 'result', subtype: 'success', is_error: true, session_id: 'cli-1', duration_ms: 5, result: said },
];

/** The CLI's retry of a request, with the HTTP status it had, or null for one no answer came to. */
const retriedWith = (status: number | null, error: string) => ({
  type: 'system', subtype: 'api_retry', session_id: 'cli-1', attempt: 1, max_retries: 1, retry_delay_ms: 0, error_status: status, error,
});

/** Whether a chat was shown the words of a failure. */
const shown = (chat: Bag[], said = SPENT): boolean => chat.some((action) => JSON.stringify(action).includes(said));

/** An hour from now, in the epoch seconds a `rate_limit_event` names its reset in. */
const inAnHour = (): number => Math.floor(Date.now() / 1000) + 3600;

/** A session on these logins, `work` first, with one turn answered on `work`. */
const answeredOnce = async (logins: Logins, names = ['work', 'personal'], extra: Record<string, unknown> = {}) => {
  const session = open({ logins: names }, logins, extra);
  await settle();
  await turn(session.session, 't1', 'one');
  expect(tokenOf()).toBe('token-work');
  return session;
};

describe('a failed login', () => {
  it('moves a turn a 429 failed before any part to the next login, cut back to the turn before it', async () => {
    const { session, chat } = await answeredOnce(twoLogins());
    session.sendMessage('t2', 'two');
    await settle();
    const first = sdk.said.at(-1);
    sdk.push(...failure('rate_limit'));
    await settle();

    expect(sdk.queries).toHaveLength(2);
    expect(tokenOf()).toBe('token-personal');
    expect(sdk.queries.at(-1)?.options.resume).toBe('cli-1');
    expect(sdk.queries.at(-1)?.options.resumeSessionAt).toBe('end-t1');
    // The same prompt, under a new uuid, to the new CLI.
    expect(sdk.said.at(-1)).toMatchObject({ content: 'two', query: 1 });
    expect(sdk.said.at(-1)?.uuid).not.toBe(first?.uuid);
    expect(ofTurn(chat, 'chat/error', 't2')).toEqual([]);
    expect(shown(chat)).toBe(false);
    sdk.push(...answered('t2'));
    await settle();
    expect(ofTurn(chat, 'chat/turnComplete', 't2')).toHaveLength(1);

    // A failure that names no retry time is not remembered: the next turn
    // starts on the first login again.
    session.sendMessage('t3', 'three');
    await settle();
    expect(sdk.queries).toHaveLength(3);
    expect(tokenOf()).toBe('token-work');
  });

  it('moves a turn the same way for a 5xx and a 529 the API answered', async () => {
    for (const [error, said, status] of [
      ['server_error', 'API Error: 500 Internal server error. This is a server-side issue, usually temporary.', 500],
      ['overloaded', 'API Error: 529 Overloaded', 529],
    ] as const) {
      sdk.reset();
      const { session, chat } = await answeredOnce(twoLogins());
      session.sendMessage('t2', 'two');
      await settle();
      sdk.push(retriedWith(status, error), ...failure(error, said));
      await settle();
      expect(tokenOf(), said).toBe('token-personal');
      expect(sdk.said.at(-1), said).toMatchObject({ content: 'two', query: 1 });
      expect(shown(chat, said), said).toBe(false);
    }
  });

  it('keeps a login whose 429 names its reset out until then, for the next turn and for other conversations', async () => {
    const clock = { now: Date.now() };
    const logins = new OpenLogins(() => clock.now);
    opened(logins, 'work', 'token-work');
    opened(logins, 'personal', 'token-personal');
    const reset = Math.floor(clock.now / 1000) + 3600;
    const { session } = await answeredOnce(logins);
    session.sendMessage('t2', 'two');
    await settle();
    sdk.push(...failure('rate_limit', SPENT, reset));
    await settle();
    expect(tokenOf()).toBe('token-personal');
    sdk.push(...answered('t2'));
    await settle();

    // The next turn stays on the CLI it moved to.
    await turn(session, 't3', 'three');
    expect(sdk.queries).toHaveLength(2);
    // Another conversation starts on the next login too.
    open({ logins: ['work', 'personal'] }, logins, { uri: 'ahp-session:/elsewhere', chatUri: 'ahp-chat:/elsewhere' });
    await settle();
    expect(tokenOf()).toBe('token-personal');

    // Once the reset passes, a turn starts on the first login again.
    clock.now = reset * 1000 + 1;
    session.sendMessage('t4', 'four');
    await settle();
    expect(tokenOf()).toBe('token-work');
    expect(sdk.said.at(-1)).toMatchObject({ content: 'four' });
  });

  it('notes each call of a login: a failure with its words and when the login is back, a turn that went through as one that worked', async () => {
    const clock = { now: Date.now() };
    const logins = new OpenLogins(() => clock.now);
    opened(logins, 'work', 'token-work');
    opened(logins, 'personal', 'token-personal');
    const calls: { id: string; outcome: Bag }[] = [];
    logins.onCall = (id, outcome) => { calls.push({ id, outcome }); };
    const reset = Math.floor(clock.now / 1000) + 3600;
    const { session } = await answeredOnce(logins);
    session.sendMessage('t2', 'two');
    await settle();
    sdk.push(...failure('rate_limit', SPENT, reset));
    await settle();
    sdk.push(...answered('t2'));
    await settle();

    expect(calls).toEqual([
      { id: 'work', outcome: { ok: true } },
      { id: 'work', outcome: { ok: false, error: `rate_limit: ${SPENT}; back at ${new Date(reset * 1000).toISOString()}` } },
      { id: 'personal', outcome: { ok: true } },
    ]);
  });

  it('brings a resting login back at once when a put opens it again', async () => {
    const logins = twoLogins();
    const { session } = await answeredOnce(logins);
    session.sendMessage('t2', 'two');
    await settle();
    sdk.push(...failure('rate_limit', SPENT, inAnHour()));
    await settle();
    expect(tokenOf()).toBe('token-personal');
    sdk.push(...answered('t2'));
    await settle();

    opened(logins, 'work', 'token-work-again');
    session.sendMessage('t3', 'three');
    await settle();
    expect(tokenOf()).toBe('token-work-again');
  });

  it('sends a steering message the failed attempt held to the next login, behind the prompt it sends again', async () => {
    const recorded: [string, string][] = [];
    const { session, chat } = await answeredOnce(twoLogins(), ['work', 'personal'], {
      onTurnRecorded: (turnId: string, transcriptId: string) => { recorded.push([turnId, transcriptId]); },
    });
    session.sendMessage('t2', 'two');
    await settle();
    const first = sdk.said.at(-1);
    expect(session.sendSteeringMessage?.({ id: 's1', text: 'and three' })).toBe(true);
    await settle();
    const held = sdk.said.at(-1);
    expect(held).toMatchObject({ content: 'and three', query: 0 });
    sdk.push(...failure('rate_limit', SPENT, inAnHour()));
    await settle();

    // The prompt again and the message behind it, each under a uuid of its own.
    const sent = sdk.said.filter((one) => one.query === 1);
    expect(sent.map((one) => one.content)).toEqual(['two', 'and three']);
    const [again, steered] = sent;
    expect(again?.uuid).not.toBe(first?.uuid);
    expect(steered?.uuid).not.toBe(held?.uuid);
    // The host is told the prompt's new uuid is the turn's, and nothing of the
    // message's, so a read puts the message inside the turn.
    expect(recorded).toContainEqual(['t2', String(again?.uuid)]);
    expect(recorded.map(([, id]) => id)).not.toContain(String(steered?.uuid));

    // The turn ends once the new CLI has answered both, with both answers in it.
    sdk.push(...answeredFor(String(again?.uuid), 'answer two'));
    await settle();
    expect(ofTurn(chat, 'chat/turnComplete', 't2')).toEqual([]);
    sdk.push(...answeredFor(String(steered?.uuid), 'answer three'));
    await settle();
    expect(ofTurn(chat, 'chat/turnComplete', 't2')).toHaveLength(1);
    // The host says each turn's start, and the session none.
    expect(chat.filter((action) => action.type === 'chat/turnStarted')).toEqual([]);
    const t2 = JSON.stringify(chat.filter((action) => action.turnId === 't2'));
    expect(t2).toContain('answer two');
    expect(t2).toContain('answer three');
  });

  it('sends a steering message whose attachments were still being read at the move to the next login once', async () => {
    const { session } = await answeredOnce(twoLogins());
    session.sendMessage('t2', 'two');
    await settle();
    const note = join(mkdtempSync(join(tmpdir(), 'ahpd-logins-note-')), 'note.txt');
    writeFileSync(note, 'one\n');
    let release = (): void => {};
    blocks.gate = new Promise<void>((resolve) => { release = resolve; });
    const attachment = { type: 'resource', uri: `file://${note}`, label: 'note.txt', contentType: 'text/plain' } as unknown as MessageAttachment;
    expect(session.sendSteeringMessage?.({ id: 's1', text: 'and three', attachments: [attachment] })).toBe(true);
    await settle();
    // Not sent yet: its attachment is still being read as the move comes.
    expect(sdk.said.map((one) => one.content)).toEqual(['one', 'two']);
    sdk.push(...failure('rate_limit', SPENT, inAnHour()));
    await settle();
    release();
    await settle();

    const sent = sdk.said.filter((one) => one.query === 1);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ content: 'two' });
    expect(JSON.stringify(sent[1]?.content)).toContain('and three');
    expect(sdk.said.filter((one) => one.query === 0)).toHaveLength(2);
  });

  /*
   * The queue hands its entries over in the order they went, as VS Code's
   * prompt queue shifts them, so a steering message whose blocks are built
   * waits behind one whose attachments are still being read. At the move both
   * leave the queue, so the next login is sent the prompt again and each of
   * them once, in that order.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudePromptQueue.ts#L69-L94
   */
  it('sends a built steering message held behind one still being read at the move to the next login once, behind the prompt', async () => {
    const { session } = await answeredOnce(twoLogins());
    session.sendMessage('t2', 'two');
    await settle();
    const note = join(mkdtempSync(join(tmpdir(), 'ahpd-logins-note-')), 'note.txt');
    writeFileSync(note, 'one\n');
    let release = (): void => {};
    blocks.gate = new Promise<void>((resolve) => { release = resolve; });
    const attachment = { type: 'resource', uri: `file://${note}`, label: 'note.txt', contentType: 'text/plain' } as unknown as MessageAttachment;
    expect(session.sendSteeringMessage?.({ id: 's1', text: 'and three', attachments: [attachment] })).toBe(true);
    expect(session.sendSteeringMessage?.({ id: 's2', text: 'and four' })).toBe(true);
    await settle();
    // Neither sent yet: the first is still being read, and the second waits behind it.
    expect(sdk.said.map((one) => one.content)).toEqual(['one', 'two']);
    sdk.push(...failure('rate_limit', SPENT, inAnHour()));
    await settle();
    release();
    // The attachment is read from disk before either goes, which takes real time rather than a few turns.
    await until(() => sdk.said.filter((one) => one.query === 1).length >= 3);
    await settle();

    const sent = sdk.said.filter((one) => one.query === 1).map((one) => JSON.stringify(one.content));
    expect(sent).toHaveLength(3);
    expect(sent[0]).toBe('"two"');
    expect(sent[1]).toContain('and three');
    expect(sent[2]).toBe('"and four"');
    expect(sdk.said.filter((one) => one.query === 0)).toHaveLength(2);
  });

  it('ends a turn that failed after it showed a part with the failure, and runs nothing again', async () => {
    const { session, chat } = await answeredOnce(twoLogins());
    session.sendMessage('t2', 'two');
    await settle();
    sdk.push(
      { type: 'assistant', parent_tool_use_id: null, uuid: 'part-t2', session_id: 'cli-1', message: { id: 'msg-part', role: 'assistant', model: 'claude-x', content: [{ type: 'text', text: 'half an answer' }] } },
      ...failure('rate_limit', SPENT, inAnHour()),
    );
    await settle();
    expect(sdk.queries).toHaveLength(1);
    expect(sdk.said.filter((one) => one.content === 'two')).toHaveLength(1);
    expect(ofTurn(chat, 'chat/error', 't2')).toHaveLength(1);
    expect(shown(chat)).toBe(true);

    // The reset it named keeps the login out, so the next turn starts on the next one.
    session.sendMessage('t3', 'three');
    await settle();
    expect(sdk.queries).toHaveLength(2);
    expect(tokenOf()).toBe('token-personal');
    expect(sdk.queries.at(-1)?.options.resumeSessionAt).toBeUndefined();
  });

  it('starts a conversation that failed on its first turn over under its id', async () => {
    const id = randomUUID();
    const { session, chat } = open({ logins: ['work', 'personal'] }, twoLogins(), { uri: `ahp-session:/${id}`, chatUri: `ahp-chat:/${id}` });
    await settle();
    session.sendMessage('t1', 'one');
    await settle();
    expect(sdk.queries.at(-1)?.options.sessionId).toBe(id);
    sdk.push(...failure('rate_limit').map((frame) => ({ ...frame, session_id: id })));
    await until(() => sdk.queries.length === 2);

    // No entry comes before the first prompt, so the conversation goes whole and
    // a new one begins under the same id, as a chat truncated whole does.
    expect(sdk.deleted).toEqual([id]);
    expect(sdk.queries).toHaveLength(2);
    expect(tokenOf()).toBe('token-personal');
    expect(sdk.queries.at(-1)?.options.resume).toBeUndefined();
    expect(sdk.queries.at(-1)?.options.sessionId).toBe(id);
    expect(sdk.said.at(-1)).toMatchObject({ content: 'one', query: 1 });
    expect(ofTurn(chat, 'chat/error', 't1')).toEqual([]);
  });

  it('starts a conversation over when the CLI it stopped raises as it ends, and runs its next turn', async () => {
    // A close may raise afterwards, which `consume` reads as a CLI put away.
    sdk.raising = true;
    const id = randomUUID();
    const { session, chat } = open({ logins: ['work', 'personal'] }, twoLogins(), { uri: `ahp-session:/${id}`, chatUri: `ahp-chat:/${id}` });
    await settle();
    session.sendMessage('t1', 'one');
    await settle();
    sdk.push(...failure('rate_limit').map((frame) => ({ ...frame, session_id: id })));
    await until(() => sdk.queries.length === 2);
    expect(sdk.deleted).toEqual([id]);
    expect(ofTurn(chat, 'chat/error', 't1')).toEqual([]);
    sdk.push(...answered('t1').map((frame) => ({ ...frame, session_id: id })));
    await settle();
    expect(ofTurn(chat, 'chat/turnComplete', 't1')).toHaveLength(1);

    // The CLI stopped for the delete ended while the delete ran, and the session
    // is not one whose CLI went away: the next turn runs.
    session.sendMessage('t2', 'two');
    await settle();
    expect(ofTurn(chat, 'chat/error', 't2')).toEqual([]);
    expect(sdk.said.at(-1)).toMatchObject({ content: 'two' });
  });

  it('keeps a conversation it could not delete, and ends the turn with the failure', async () => {
    const before = process.env.CLAUDE_CONFIG_DIR;
    const home = mkdtempSync(join(tmpdir(), 'ahpd-logins-home-'));
    process.env.CLAUDE_CONFIG_DIR = home;
    try {
      const id = randomUUID();
      // The CLI wrote the failed prompt, and the delete of it fails.
      mkdirSync(join(home, 'projects', 'elsewhere'), { recursive: true });
      writeFileSync(join(home, 'projects', 'elsewhere', `${id}.jsonl`), '{}\n');
      sdk.undeletable.add(id);
      const { session, chat } = open({ logins: ['work', 'personal'] }, twoLogins(), { uri: `ahp-session:/${id}`, chatUri: `ahp-chat:/${id}` });
      await settle();
      session.sendMessage('t1', 'one');
      await settle();
      sdk.push(...failure('rate_limit').map((frame) => ({ ...frame, session_id: id })));
      await until(() => sdk.queries.length === 2);

      // The conversation comes back as it is, on the next login, and the prompt
      // is not sent again: it is in the conversation already.
      expect(sdk.deleted).toEqual([]);
      expect(sdk.queries.at(-1)?.options.resume).toBe(id);
      expect(sdk.queries.at(-1)?.options.resumeSessionAt).toBeUndefined();
      expect(tokenOf()).toBe('token-personal');
      expect(sdk.said.filter((one) => one.query === 1)).toEqual([]);
      const failed = ofTurn(chat, 'chat/error', 't1');
      expect(failed).toHaveLength(1);
      expect(JSON.stringify(failed[0])).toContain(SPENT);
      expect(JSON.stringify(failed[0])).toContain('permission denied');

      // The failure named no retry time, so the next turn starts on the first
      // login again, in the conversation as it came back.
      session.sendMessage('t2', 'two');
      await settle();
      expect(ofTurn(chat, 'chat/error', 't2')).toEqual([]);
      expect(tokenOf()).toBe('token-work');
      expect(sdk.queries.at(-1)?.options.resume).toBe(id);
      expect(sdk.said.at(-1)).toMatchObject({ content: 'two', query: 2 });
    }
    finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    }
  });

  /*
   * A steering message is answered only in the turn it steered, as the
   * reference steering entry takes the in-flight send's turn: a turn that ends
   * with the failure takes the message it held with it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L454-L470
   */
  it('sends no steering message the failed attempt held to the CLI after it, when the turn ends with the failure', async () => {
    const id = '0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d';
    const before = process.env.CLAUDE_CONFIG_DIR;
    const home = mkdtempSync(join(tmpdir(), 'ahpd-logins-home-'));
    process.env.CLAUDE_CONFIG_DIR = home;
    try {
      mkdirSync(join(home, 'projects', 'elsewhere'), { recursive: true });
      writeFileSync(join(home, 'projects', 'elsewhere', `${id}.jsonl`), '{}\n');
      sdk.undeletable.add(id);
      const { session, chat } = open({ logins: ['work', 'personal'] }, twoLogins(), { uri: `ahp-session:/${id}`, chatUri: `ahp-chat:/${id}` });
      await settle();
      session.sendMessage('t1', 'one');
      await settle();
      expect(session.sendSteeringMessage?.({ id: 's1', text: 'and two' })).toBe(true);
      await settle();
      sdk.push(...failure('rate_limit').map((frame) => ({ ...frame, session_id: id })));
      await until(() => sdk.queries.length === 2);
      await settle();

      // The turn ends with the failure, and the CLI after it is sent nothing of it.
      expect(ofTurn(chat, 'chat/error', 't1')).toHaveLength(1);
      expect(sdk.said.filter((one) => one.query === 1)).toEqual([]);
      expect(chat.filter((action) => action.type === 'chat/turnStarted')).toEqual([]);
    }
    finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    }
  });

  it('ends a turn whose turn before it has no end to cut back to, and starts nothing over', async () => {
    // A turn read back from the transcript: this process never saw its end.
    const seed = [{ id: 'r1', message: { text: 'earlier', origin: { kind: 'user' } }, responseParts: [], state: 'complete' }];
    const { session, chat } = open({ logins: ['work', 'personal'] }, twoLogins(), { resume: 'cli-1', seed });
    await settle();
    session.sendMessage('t2', 'two');
    await settle();
    sdk.push(...failure('rate_limit', SPENT, inAnHour()));
    await settle();
    expect(sdk.queries).toHaveLength(1);
    expect(ofTurn(chat, 'chat/error', 't2')).toHaveLength(1);
    expect(sdk.deleted).toEqual([]);

    session.sendMessage('t3', 'three');
    await settle();
    expect(sdk.queries).toHaveLength(2);
    expect(tokenOf()).toBe('token-personal');
    expect(sdk.queries.at(-1)?.options.resumeSessionAt).toBeUndefined();
  });

  it('ends the turn with the last failure and the earliest retry time when every login fails', async () => {
    const logins = twoLogins();
    opened(logins, 'home', 'token-home');
    const { session, chat } = await answeredOnce(logins, ['work', 'personal', 'home']);
    const soon = Math.floor(Date.now() / 1000) + 600;
    session.sendMessage('t2', 'two');
    await settle();
    sdk.push(...failure('rate_limit', SPENT, soon + 3600));
    await settle();
    expect(tokenOf()).toBe('token-personal');
    sdk.push(...failure('rate_limit', SPENT, soon));
    await settle();
    expect(tokenOf()).toBe('token-home');
    const down = 'API Error: 500 Internal server error';
    sdk.push(retriedWith(500, 'server_error'), ...failure('server_error', down));
    await settle();

    expect(sdk.queries).toHaveLength(3);
    const failed = ofTurn(chat, 'chat/error', 't2');
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed[0])).toContain(down);
    expect(JSON.stringify(failed[0])).toContain(`personal is back first, at ${new Date(soon * 1000).toISOString()}`);
  });

  /*
   * A server's failure the API never answered may have run at the provider,
   * so the turn ends with it and no other login runs it again, as the model
   * proxy sends a call that may have arrived to no other entry; one the API
   * answered with a 5xx moves on.
   */
  it('ends the turn on a server failure no answer came to, and moves on from one the API answered', async () => {
    const logins = twoLogins();
    const { session, chat } = await answeredOnce(logins, ['work', 'personal']);
    session.sendMessage('t2', 'two');
    await settle();
    const lost = 'API Error: Connection error.';
    sdk.push(retriedWith(null, 'server_error'), ...failure('server_error', lost));
    await settle();
    expect(sdk.queries).toHaveLength(1);
    expect(tokenOf()).toBe('token-work');
    expect(JSON.stringify(ofTurn(chat, 'chat/error', 't2'))).toContain(lost);

    session.sendMessage('t3', 'three');
    await settle();
    sdk.push(retriedWith(529, 'overloaded'), ...failure('overloaded', 'API Error: 529 Overloaded'));
    await settle();
    expect(tokenOf()).toBe('token-personal');
  });

  it('refuses a turn that starts with every open login resting, and names the earliest retry time', async () => {
    const logins = twoLogins();
    const { session, chat } = open({ logins: ['work', 'personal'] }, logins);
    await settle();
    const soon = Date.now() + 600_000;
    logins.rest('work', 'token-work', soon + 3_600_000);
    logins.rest('personal', 'token-personal', soon);
    session.sendMessage('t1', 'one');
    await settle();
    const failed = ofTurn(chat, 'chat/error', 't1');
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed[0])).toContain(`No login this agent names is ready: personal is back first, at ${new Date(soon).toISOString()}`);
    expect(sdk.said).toEqual([]);
  });

  it('ends a turn whose credential was refused naming the login, and tries no other login', async () => {
    const { session, chat } = await answeredOnce(twoLogins());
    const denied = 'Failed to authenticate. API Error: 401 OAuth access token is invalid.';
    session.sendMessage('t2', 'two');
    await settle();
    sdk.push(...failure('authentication_failed', denied));
    await settle();
    expect(sdk.queries).toHaveLength(1);
    const failed = ofTurn(chat, 'chat/error', 't2');
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed[0])).toContain('Claude refused login work (authentication_failed)');
    expect(shown(chat, denied)).toBe(false);

    // Nothing is remembered: the next turn starts on the same login.
    await turn(session, 't3', 'three');
    expect(sdk.queries).toHaveLength(1);
    expect(sdk.said.at(-1)).toMatchObject({ content: 'three', query: 0 });
  });

  it('ends the turn the same way for each other 401 or 403 of the login', async () => {
    for (const error of ['oauth_org_not_allowed', 'verification_required']) {
      sdk.reset();
      const { session, chat } = await answeredOnce(twoLogins());
      session.sendMessage('t2', 'two');
      await settle();
      sdk.push(...failure(error, `refused for ${error}`));
      await settle();
      expect(sdk.queries, error).toHaveLength(1);
      expect(JSON.stringify(ofTurn(chat, 'chat/error', 't2')), error).toContain(`Claude refused login work (${error})`);
    }
  });

  // One case per error: seven turns in one case took most of a Windows case's budget.
  it.each(['billing_error', 'account_on_hold', 'invalid_request', 'model_not_found', 'unknown', 'max_output_tokens', 'cloud_credential_error'])(
    'ends the turn as it does today for every other error (%s)',
    async (error) => {
      sdk.reset();
      const { session, chat } = await answeredOnce(twoLogins());
      session.sendMessage('t2', 'two');
      await settle();
      const said = `the CLI's words for ${error}`;
      sdk.push(...failure(error, said));
      await settle();
      expect(sdk.queries, error).toHaveLength(1);
      expect(ofTurn(chat, 'chat/error', 't2'), error).toHaveLength(1);
      expect(shown(chat, said), error).toBe(true);
    },
  );
});

/*
 * The plugin over a host of its own: the adapter and the engine it registers
 * share its logins, and a failure reaches the host as a check of that
 * connector, sent on the plugin's own connection as a client sends it.
 */
describe('the plugin', () => {
  /** A host that keeps what the plugin registers, the lines it logs, and every request its connections send. */
  const fakeHost = () => {
    const adapters: Adapter[] = [];
    const engines: Engine[] = [];
    const requests: { method: string; params: unknown }[] = [];
    const logged: string[] = [];
    let connects = 0;
    const host = {
      paths: [mkdtempSync(join(tmpdir(), 'ahpd-logins-plugin-'))],
      log: (line: string) => { logged.push(line); },
      registerAdapter: (adapter: Adapter) => { adapters.push(adapter); },
      registerEngine: (engine: Engine) => { engines.push(engine); },
      connect: () => {
        connects += 1;
        return {
          request: async (method: string, params: unknown) => { requests.push({ method, params }); return {}; },
          notify: () => {},
          send: () => {},
          onMessage: () => {},
          close: () => {},
        };
      },
    } as unknown as PluginHost;
    return { host, adapters, engines, requests, logged, connects: () => connects };
  };

  /** One connector of `claude-login`, as the host hands it to `open` and `check`. */
  const connectorOf = (id: string, token: string): Connector => ({ id, adapter: 'claude-login', owner: 'host', config: { token } });

  /*
   * A failed call noted and logged, and no check run, as the model proxy
   * keeps a failed attempt; the connection offers every version the protocol
   * package speaks, as ahpd's own nested client does.
   */
  it("logs a login's failure and asks the host to keep each call of it, on one connection, checking nothing", async () => {
    const { apply } = await import('../src/plugin.js');
    const { host, adapters, engines, requests, logged, connects } = fakeHost();
    // Before the load, which is when the adapter takes the `fetch` it checks with.
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    await apply(host, {});
    const adapter = adapters.find((one) => one.name === 'claude-login');
    const engine = engines.find((one) => one.name === 'claude');
    if (adapter === undefined || engine === undefined) throw new Error('the plugin registered no claude-login adapter or claude engine');
    adapter.open(connectorOf('work', 'token-work'));
    adapter.open(connectorOf('personal', 'token-personal'));

    const view: AgentView = {
      id: 'claude-logins', engine: 'claude', owner: 'host', name: 'Logins',
      description: undefined, icon: undefined, model: undefined, config: { logins: ['work', 'personal'] },
    };
    const start: Start = {
      uri: 'ahp-session:/claude-logins', chatUri: 'ahp-chat:/claude-logins', settings: {}, clientToolTimeoutMs: 60_000,
      schema: () => ({ type: 'object', properties: {} }),
      emit: () => {},
      workingDirectory: host.paths[0] as string,
    };
    const session = startedNow(engine.open(view).create(start));
    await settle();
    await turn(session, 't1', 'one');
    expect(tokenOf()).toBe('token-work');

    try {
      const denied = 'Failed to authenticate. API Error: 401 OAuth access token is invalid.';
      session.sendMessage('t2', 'two');
      await settle();
      sdk.push(...failure('authentication_failed', denied));
      await until(() => requests.length >= 3);
      expect(requests).toEqual([
        { method: 'initialize', params: { clientId: 'agent-claude', protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS] } },
        // The first turn's calls went through.
        { method: 'x-ahpd/connectors/note', params: { id: 'work', ok: true } },
        { method: 'x-ahpd/connectors/note', params: { id: 'work', ok: false, error: `authentication_failed: ${denied}` } },
      ]);
      expect(logged.some((line) => line.includes('work') && line.includes('authentication_failed') && line.includes(denied))).toBe(true);
      // The check is the adapter's to answer when the host asks, and the
      // failure asked it nothing; each open asked the profile once.
      const urls = (fetcher.mock.calls as unknown[][]).map(([url]) => String(url));
      expect(urls).toEqual(['https://api.anthropic.com/api/oauth/profile', 'https://api.anthropic.com/api/oauth/profile']);
      expect(await adapter.check?.(connectorOf('work', 'token-work'))).toEqual({ result: 'ok' });

      // A failure that moves the turn is kept too, on the same connection.
      session.sendMessage('t3', 'three');
      await settle();
      sdk.push(...failure('rate_limit'));
      await until(() => requests.length >= 4);
      expect(requests.slice(3)).toEqual([
        { method: 'x-ahpd/connectors/note', params: { id: 'work', ok: false, error: `rate_limit: ${SPENT}` } },
      ]);
      expect(tokenOf()).toBe('token-personal');
      expect(connects()).toBe(1);
    }
    finally {
      vi.unstubAllGlobals();
    }
  });
});
