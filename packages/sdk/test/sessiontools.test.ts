import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uriOf } from '../src/resources/fileuri.js';
import { Status } from '../src/sessions/catalog.js';
import { ROOT, createHost } from '../src/host.js';
import { fileSessions } from '../src/sessions/sessions.js';
import { hostTools } from '../src/tools/index.js';
import {
  filterSessions, openLink, serializeContext, serializeSession, sessionMeant, sessionTools, statusWords,
} from '../src/tools/session.js';
import { directory, hello, root, signIn } from './users-gate-helpers.js';
import { claude, echo, machine, peer, resetSdk, sdk, sessionQueries, settle } from './support/host.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Summary } from '../src/types/catalog.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { sdkVersion } from '../src/version.js';
import type { BoundTool } from '../src/types/agent.js';
import type { HostEvent } from '../src/types/events.js';
import type { HostOptions, HostTool, ToolCaller } from '../src/types/host.js';
import type { Contribution, LoaderContext } from '../src/types/plugin.js';
import type { Grant, Principal, Users } from '../src/types/users.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * The session tools, in the shapes VS Code's host answers them.
 *
 * What is under test is the mapping: the same names, the same filters, the
 * same keys in the rows and the same words in the answers, so a skill written
 * against the reference host reads these without noticing. The host half -
 * that a message actually starts a turn, that a session actually appears - is
 * in `host.test.ts`, where the backend is faked.
 */

const row = (over: Partial<Summary> & Record<string, unknown> = {}): Summary => ({
  resource: 'ahp-session:/s1',
  provider: 'claude',
  title: 'Fix the kqueue build',
  status: Status.Idle | Status.IsRead,
  createdAt: '2026-09-13T10:00:00.000Z',
  modifiedAt: '2026-09-13T11:00:00.000Z',
  workingDirectories: ['file:///brb_main/src/brb_backend'],
  ...over,
});

describe('the names a tool has for a session', () => {
  it('links the way the reference window opens: provider, id, and the chat when one is meant', () => {
    expect(openLink('ahp-session:/abc', 'claude')).toBe('agent-host-session://claude/abc');
    expect(openLink('claude:/abc', 'claude', 'c 2')).toBe('agent-host-session://claude/abc?chat=c%202');
  });

  it('finds a row by its URI or by its link, under either scheme', () => {
    const rows = [row(), row({ resource: 'claude:/on-disk' })];
    expect(sessionMeant('ahp-session:/s1', rows)?.session.resource).toBe('ahp-session:/s1');
    expect(sessionMeant('agent-host-session://claude/s1', rows)?.session.resource).toBe('ahp-session:/s1');
    expect(sessionMeant('agent-host-session://claude/on-disk', rows)?.session.resource).toBe('claude:/on-disk');
    expect(sessionMeant('agent-host-session://claude/s1?chat=side', rows)).toMatchObject({ chatId: 'side' });
    // Another provider's id is another session, however the id reads.
    expect(sessionMeant('agent-host-session://codex/s1', rows)).toBeUndefined();
    expect(sessionMeant('ahp-session:/nobody', rows)).toBeUndefined();
  });
});

describe('the words a status answers to', () => {
  it('names the activity once, and the flags beside it', () => {
    expect(statusWords(Status.Idle)).toEqual(['idle']);
    expect(statusWords(Status.InProgress)).toEqual(['inProgress']);
    // `inputNeeded` carries the in-progress bit; it is not both.
    expect(statusWords(Status.InputNeeded)).toEqual(['inputNeeded']);
    expect(statusWords(Status.Idle | Status.Error | Status.IsArchived)).toEqual(['idle', 'error', 'archived']);
    expect(statusWords(Status.IsRead)).toEqual([]);
  });
});

describe('a row as list_sessions answers it', () => {
  it('carries the reference host\'s keys, and only the ones with a value', () => {
    const said = serializeSession(row({
      activity: 'Grep: input.c',
      project: { uri: 'file:///brb_main/src/brb_backend', displayName: 'brb_backend' },
      changes: { files: 2, additions: 10, deletions: 3 },
      _meta: {
        git: { branchName: 'fix/kqueue', baseBranchName: 'main', outgoingChanges: 1, incomingChanges: 0, uncommittedChanges: 4 },
        github: { owner: 'brbyte', repo: 'brb_backend', pullRequestUrls: ['https://github.com/brbyte/brb_backend/pull/412'] },
      },
    }));
    expect(said).toEqual({
      session: 'ahp-session:/s1',
      openLink: 'agent-host-session://claude/s1',
      title: 'Fix the kqueue build',
      status: 'idle',
      activity: 'Grep: input.c',
      workingDirectory: 'file:///brb_main/src/brb_backend',
      project: 'brb_backend',
      projectUri: 'file:///brb_main/src/brb_backend',
      createdAt: '2026-09-13T10:00:00.000Z',
      modifiedAt: '2026-09-13T11:00:00.000Z',
      changes: { files: 2, additions: 10, deletions: 3 },
      git: { branch: 'fix/kqueue', baseBranch: 'main', ahead: 1, behind: 0, uncommittedChanges: 4 },
      github: { owner: 'brbyte', repo: 'brb_backend', pullRequestUrl: 'https://github.com/brbyte/brb_backend/pull/412' },
    });
  });

  it('says unread when the read bit is off, and lists the directories only when there are several', () => {
    const said = serializeSession(row({ status: Status.Idle, workingDirectories: ['file:///a', 'file:///b'] }));
    expect(said.unread).toBe(true);
    expect(said.workingDirectory).toBe('file:///a');
    expect(said.workingDirectories).toEqual(['file:///a', 'file:///b']);
    expect(serializeSession(row()).unread).toBeUndefined();
    expect(serializeSession(row()).workingDirectories).toBeUndefined();
  });
});

describe('the filters list_sessions takes', () => {
  const rows = [
    row({ resource: 'ahp-session:/idle' }),
    row({ resource: 'ahp-session:/busy', status: Status.InProgress | Status.IsRead, createdAt: '2026-09-14T00:00:00.000Z' }),
    row({ resource: 'ahp-session:/asking', status: Status.InputNeeded }),
    row({ resource: 'ahp-session:/done', status: Status.Idle | Status.IsRead | Status.IsArchived }),
    row({
      resource: 'ahp-session:/elsewhere',
      workingDirectories: ['file:///github/ahpc'],
      project: { uri: 'file:///github/ahpc', displayName: 'ahpc' },
      changes: { files: 1 },
      _meta: { github: { pullRequestUrls: ['https://github.com/softov/ahpc/pull/1'] } },
    }),
  ];
  const names = (args: Record<string, unknown>) => filterSessions(rows, args).map((one) => one.resource.slice('ahp-session:/'.length));

  it('leaves the archived out unless asked, either way', () => {
    expect(names({})).toEqual(['idle', 'busy', 'asking', 'elsewhere']);
    expect(names({ includeArchived: true })).toContain('done');
    expect(names({ status: ['archived'] })).toEqual(['done']);
  });

  it('matches a status by any of its words', () => {
    expect(names({ status: ['inProgress', 'inputNeeded'] })).toEqual(['busy', 'asking']);
  });

  it('matches a workspace by project name, project URI, or directory', () => {
    expect(names({ workspace: 'ahpc' })).toEqual(['elsewhere']);
    expect(names({ workspace: 'file:///github/ahpc' })).toEqual(['elsewhere']);
    expect(names({ workspace: '/github/ahpc/' })).toEqual(['elsewhere']);
  });

  it('matches a directory with a space, however the URI was written', () => {
    const dir = join(tmpdir(), 'ahpd spaced dir');
    const spaced = row({ resource: 'ahp-session:/spaced', workingDirectories: [uriOf(dir)] });
    const found = (args: Record<string, unknown>) =>
      filterSessions([spaced], args).map((one) => one.resource);
    // A URI the client encoded and a path somebody typed are the same place,
    // and a workspace filter that compared their text matched neither.
    expect(found({ workspace: uriOf(dir).replace('%20', ' ') })).toEqual(['ahp-session:/spaced']);
    expect(found({ workspace: uriOf(dir) })).toEqual(['ahp-session:/spaced']);
    expect(found({ workspace: `${dir}/` })).toEqual(['ahp-session:/spaced']);
  });

  it('keeps the flags the reference host filters on', () => {
    expect(names({ unread: true })).toEqual(['asking']);
    expect(names({ withChanges: true })).toEqual(['elsewhere']);
    expect(names({ withPullRequest: true })).toEqual(['elsewhere']);
    expect(names({ createdAfter: '2026-09-13T12:00:00Z' })).toEqual(['busy']);
    expect(names({ createdBefore: '2026-09-13T12:00:00Z' })).toEqual(['idle', 'asking', 'elsewhere']);
  });

  it('answers a direct lookup with that row alone, archived or not', () => {
    expect(names({ session: 'agent-host-session://claude/done' })).toEqual(['done']);
    expect(names({ session: 'ahp-session:/nobody' })).toEqual([]);
  });

  it('refuses an argument of the wrong shape in the reference host\'s words', () => {
    expect(() => filterSessions(rows, { unread: 'yes' })).toThrow('Invalid list_sessions input: unread must be a boolean.');
    expect(() => filterSessions(rows, { createdAfter: 'yesterday' })).toThrow('createdAfter must be an ISO-8601 timestamp');
  });
});

describe('a transcript as get_session_context answers it', () => {
  const turn = (id: string, user: string, assistant: string, calls: { toolName: string; toolInput?: unknown; status?: string }[] = []) => ({
    id,
    state: 'complete',
    message: { text: user, origin: { kind: 'user' } },
    responseParts: [
      { kind: 'markdown', id: `${id}-m`, content: assistant },
      ...calls.map((call, index) => ({ kind: 'toolCall', id: `${id}-c${index}`, toolCall: { status: 'completed', ...call } })),
    ],
  });
  const snapshot = {
    turns: [
      turn('t1', 'what is in this directory', 'Four files.', [{ toolName: 'Bash', toolInput: { command: 'ls' } }]),
      turn('t2', 'delete the old script', 'Left it: it is FreeBSD-only.'),
    ],
    activeTurn: { id: 't3', message: { text: 'and the makefile?' }, responseParts: [] },
    hasMoreHistory: true,
  };

  it('numbers the turns, marks the running one, and holds the tool calls back at summary', () => {
    const said = serializeContext(row(), undefined, snapshot, 'summary', 10);
    expect(said.openLink).toBe('agent-host-session://claude/s1');
    expect(said.hasMoreHistory).toBe(true);
    expect(said.truncated).toBe(false);
    expect(said.transcript).toEqual([
      { turn: 1, state: 'complete', user: 'what is in this directory', assistant: 'Four files.' },
      { turn: 2, state: 'complete', user: 'delete the old script', assistant: 'Left it: it is FreeBSD-only.' },
      { turn: 3, state: 'inProgress', user: 'and the makefile?' },
    ]);
  });

  it('names the tool calls at digest and shows their input at full', () => {
    const digest = serializeContext(row(), 'side', snapshot, 'digest', 10);
    expect(digest.openLink).toBe('agent-host-session://claude/s1?chat=side');
    expect((digest.transcript as { toolCalls?: unknown }[])[0]?.toolCalls).toEqual(['Bash']);
    const full = serializeContext(row(), undefined, snapshot, 'full', 10);
    expect((full.transcript as { toolCalls?: unknown }[])[0]?.toolCalls).toEqual([{ name: 'Bash', input: 'ls' }]);
  });

  it('keeps the newest turns inside the limit, and says it cut', () => {
    const said = serializeContext(row(), undefined, snapshot, 'summary', 2);
    expect((said.transcript as { turn: number }[]).map((one) => one.turn)).toEqual([2, 3]);
    expect(said.truncated).toBe(true);
    const long = serializeContext(row(), undefined, { turns: [turn('t1', 'x'.repeat(500), 'y')], hasMoreHistory: false }, 'summary', 10);
    expect(long.truncated).toBe(true);
    expect(String((long.transcript as { user: string }[])[0]?.user).length).toBe(160);
  });
});

describe('the set itself', () => {
  it('is the reference host\'s nine, by name, with the required fields it requires', () => {
    const tools = sessionTools();
    expect(tools.map((one) => one.definition.name)).toEqual([
      'list_sessions', 'get_current_session', 'set_workspace', 'create_session', 'create_chat',
      'rename_chat', 'send_message', 'get_session_context', 'delete_session',
    ]);
    const schema = (name: string) => tools.find((one) => one.definition.name === name)?.definition.inputSchema as { required?: string[] };
    expect(schema('create_session').required).toEqual(['relationship', 'prompt', 'title']);
    expect(schema('set_workspace').required).toEqual(['workspaceFolder', 'isolation']);
    expect(schema('send_message').required).toEqual(['session', 'message']);
    expect(schema('rename_chat').required).toEqual(['title']);
  });

  it('shapes rename_chat by the title strategy the session runs under', () => {
    const rename = sessionTools().find((one) => one.definition.name === 'rename_chat');
    expect(rename?.forSession).toBeDefined();
    // Deferred is the only strategy a session runs under, and the host reaches
    // the tool through the discovery the artifact instruction points at.
    expect(rename?.deferLoading).toBe(true);
    // A utility strategy names chats itself, so the tool is not offered.
    expect(rename?.forSession?.({ titleStrategy: 'utility' })).toEqual({ offered: false });
    // An active agent names its own chats with the tool as it stands.
    expect(rename?.forSession?.({ titleStrategy: 'activeAgent' })).toBeUndefined();
    const deferred = rename?.forSession?.({ titleStrategy: 'deferred' });
    expect(deferred?.offered).toBe(true);
    const definition = deferred?.definition as {
      description?: string; inputSchema?: { properties?: Record<string, unknown>; required?: string[] };
    };
    expect(definition.description).not.toBe(rename?.definition.description);
    expect(definition.description).toContain('Automatic naming is handled by the host');
    // No `automatic` argument under deferred naming, since the host does the
    // automatic half.
    expect(definition.inputSchema?.properties).not.toHaveProperty('automatic');
    expect(Object.keys(definition.inputSchema?.properties ?? {})).toEqual(['session', 'chat', 'title']);
    expect(definition.inputSchema?.required).toEqual(['title']);
  });
});

/*
 * The person a session tool acts for.
 *
 * A tool is reached from inside a turn and the turn carries the person who sent
 * it, so a tool answers with that person's grants rather than with the
 * window's. The turns below are real ones: a signed-in client sends them
 * through `chat/turnStarted`, and the CLI behind them is the fake one, which
 * holds a turn open until the test moves it - so every call here is made where
 * a tool call is always made, inside a turn that is running.
 */
describe('what a session tool asks of the turn it runs in', () => {
  type Answer = { content: { text: string }[]; isError?: boolean };
  type Tool = { name: string; handler: (input: unknown) => Promise<Answer> };
  type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

  /** One session's tools, as the model reaches them. */
  const toolsOf = (index = -1): Record<string, Tool> => {
    const servers = sessionQueries().at(index)?.options.mcpServers as Record<string, { tools: Tool[] }> | undefined;
    return Object.fromEntries((servers?.ahp?.tools ?? []).map((one) => [one.name, one]));
  };
  const call = async (name: string, input: unknown, index = -1): Promise<Answer> => {
    const tool = toolsOf(index)[name];
    if (!tool) throw new Error(`no ${name}`);
    return tool.handler(input);
  };
  // A refusal is a tool result too: the backend hands the model the message as
  // text, marked as an error, which is how a model hears what it got wrong.
  const said = (one: Answer): string => one.content[0]?.text ?? '';

  /**
   * A member: the read half of sessions and the write half.
   *
   * The built-in role of that name holds more - files, terminals, the proxy -
   * and none of it is anything a session tool asks about, so these two are the
   * whole of what these cases need.
   */
  const MEMBER: Grant[] = ['session:read', 'session:write'];
  /**
   * A reader: the read half, and the right to say something in what it reads.
   *
   * The second is not decoration. The built-in guest role holds `session:read`
   * alone, and a chat's write group is its session's, so a guest can never send
   * a turn - and a tool runs in a turn. These two are the least it takes to
   * stand in one: read what is here, and speak in it.
   */
  const READER: Grant[] = ['session:read', 'chat:send'];

  /** A clock a case moves, so a wake falls due without waiting for one. */
  const clock = () => {
    let at = Date.parse('2026-10-13T12:00:00Z');
    const armed: (() => void)[] = [];
    return {
      now: (): Date => new Date(at),
      timer: (fire: () => void): { cancel(): void } => {
        armed.push(fire);
        return { cancel: () => { const i = armed.indexOf(fire); if (i >= 0) armed.splice(i, 1); } };
      },
      /** Move time by `minutes`, then run whatever came due. */
      pass: (minutes: number): void => {
        at += minutes * 60_000;
        for (const fire of armed.splice(0)) fire();
      },
    };
  };

  /**
   * A host that knows these people, with a clock the case moves.
   *
   * Nothing sleeps, so a session stays the one it was across a moved clock and
   * the only thing the clock is for is the wake.
   */
  const hosting = (tokens: Record<string, Grant[]>, over: Partial<HostOptions> = {}) => {
    const time = clock();
    const host = createHost({
      path: root, agents: [claude({ paths: [root] })], ...machine(),
      users: directory(tokens), tools: hostTools(),
      now: time.now, timer: time.timer, sleepAfterMinutes: 0,
      ...over,
    });
    return { host, time };
  };

  /** One connection, signed in as whoever the token names. */
  const signing = async (host: ReturnType<typeof createHost>, token: string) => {
    const p = peer();
    const client = host.accept(p);
    await hello(client, token);
    await signIn(client, token);
    return { client, p };
  };

  /** A client watching a session and the chat it means, which is what talking in it takes. */
  const watching_ = async (client: Client, ...channels: string[]) => {
    for (const channel of channels) await client.handle({ method: 'subscribe', params: { channel } });
  };

  /** One session running on this host, and the chat it runs. */
  const opening = async (client: Client, name: string) => {
    const uri = `ahp-session:/${name}`;
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    const chat = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state.defaultChat;
    await watching_(client, chat);
    return { uri, held: `ahp-session:/${name}`, chat };
  };

  /** A client says a turn has begun in one chat, which is how a turn is sent. */
  const saying = async (client: Client, chat: string, turnId: string, text: string) => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId, message: { text } } },
    });
    await settle(8);
  };

  it('answers a reader with what it may read, and refuses it the writes', async () => {
    const { host } = hosting({ member: MEMBER, reader: READER });
    const { client: member } = await signing(host, 'member');
    const notes = await opening(member, 'notes');
    // The reader stands in the member's session: it may read the session and
    // say something in it, which is what it takes to be in a turn it may not
    // write in. The tools it reaches are that session's own.
    const { client: reader } = await signing(host, 'reader');
    await watching_(reader, notes.uri, notes.chat);
    await saying(reader, notes.chat, 'r1', 'what is in here');

    const rows = JSON.parse(said(await call('list_sessions', {}, 0))) as { sessions: { session: string }[] };
    expect(rows.sessions.map((one) => one.session)).toEqual([notes.held]);
    expect(said(await call('get_current_session', {}, 0))).toContain(notes.held);

    const refused = await call('create_session', { relationship: 'currentSession', title: 'x', prompt: 'y' }, 0);
    expect(said(refused)).toContain('may not session:write here');
    // Named, because there is a person to name: this is the host's own refusal
    // with the reader's id in front of it.
    expect(said(refused)).toContain('reader may not session:write here');
    expect(refused.isError).toBe(true);
  });

  it('carries the member into a session its turn opened, and no further', async () => {
    const { host } = hosting({ member: MEMBER, other: MEMBER });
    const { client } = await signing(host, 'member');
    const lead = await opening(client, 'lead');
    // Another person's session, to tell the member apart from the host itself:
    // a member may write a session and may not delete one that is not theirs.
    const { client: other } = await signing(host, 'other');
    const theirs = await opening(other, 'theirs');
    await saying(client, lead.chat, 't1', 'start something else');
    expect(said(await call('create_session', {
      relationship: 'independent', workspace: root, title: 'Child', prompt: 'go', worktree: false,
    }, 0))).toMatch(/^New session created \(/);
    await settle(8);

    // The child's turn is the member's, so the child may do what the member
    // may: it reads the host, and it writes a chat of its own session.
    const child = sessionQueries().length - 1;
    const rows = JSON.parse(said(await call('list_sessions', {}, child))) as { sessions: unknown[] };
    expect(rows.sessions).toHaveLength(3);
    expect(said(await call('create_session', { relationship: 'currentSession', title: 'Grandchild', prompt: 'go' }, child)))
      .toMatch(/^Chat created in the current session/);
    // And not a thing more: a session the member does not own is not theirs to
    // delete, and the child is refused it exactly as the member is.
    expect(said(await call('delete_session', { session: theirs.held }, child)))
      .toBe("Only the session's owner can delete it.");
  });

  it('lets a turn nobody sent read, and refuses it every write', async () => {
    const { host, time } = hosting({ member: MEMBER });
    const { client } = await signing(host, 'member');
    const alone = await opening(client, 'alone');
    // No turn is running, so nobody sets this wake - and the turn it begins
    // carries nobody, which is what the host's own turn looks like too. Asked
    // without a turn at all, which is what a call no backend makes looks like.
    expect(said(await call('schedule_wakeup', { delaySeconds: 60, prompt: 'carry on' }, 0))).toContain('Wakeup scheduled');
    time.pass(2);
    await settle(8);

    // A turn is running now, and it is nobody's.
    expect(said(await call('get_current_session', {}, 0))).toContain(alone.held);
    expect(said(await call('get_session_context', { session: alone.held }, 0))).toContain('transcript');
    const rows = JSON.parse(said(await call('list_sessions', {}, 0))) as { sessions: { session: string }[] };
    expect(rows.sessions.map((one) => one.session)).toEqual([alone.held]);

    for (const [name, input] of [
      ['set_workspace', { workspaceFolder: root, isolation: false }],
      ['create_session', { relationship: 'currentSession', title: 'x', prompt: 'y' }],
      ['create_chat', { prompt: 'x' }],
      ['rename_chat', { title: 'x' }],
      ['send_message', { session: alone.held, message: 'x' }],
      ['delete_session', { session: alone.held }],
    ] as [string, Record<string, unknown>][]) {
      const refused = await call(name, input, 0);
      expect(said(refused), name).toBe('this turn may not session:write here');
      expect(refused.isError, name).toBe(true);
    }
  });

  it('refuses a call with no turn running, and lists as nobody', async () => {
    const { host } = hosting({ member: MEMBER });
    const { client } = await signing(host, 'member');
    const idle = await opening(client, 'idle');
    // Nothing is running in this chat. A window outlives the turn it sent, so a
    // tool can be reached now that the turn that asked for it has ended - and
    // no turn is what carries a person, so the call is nobody's. The danger is a
    // backgrounded subagent or shell reaching a tool after its turn ended: if
    // this answered as the session's person, it would write as the member.
    expect(said(await call('send_message', { session: idle.held, message: 'x' }, 0)))
      .toBe('this turn may not session:write here');
    expect(said(await call('delete_session', { session: idle.held }, 0)))
      .toBe('this turn may not session:write here');
    // Reading is what nobody holds, so the listing still answers.
    const rows = JSON.parse(said(await call('list_sessions', {}, 0))) as { sessions: { session: string }[] };
    expect(rows.sessions.map((one) => one.session)).toEqual([idle.held]);
  });

  it('carries the member through a wake, and through a reload of the store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-wake-'));
    const { host: before } = hosting({ member: MEMBER }, { sessions: fileSessions({ dir }) });
    const { client } = await signing(before, 'member');
    const waiting = await opening(client, 'waiting');
    await saying(client, waiting.chat, 't1', 'leave a wake');
    expect(said(await call('schedule_wakeup', { delaySeconds: 60, prompt: 'come back to this' }, 0)))
      .toContain('Wakeup scheduled');
    await before.close();
    // The transcript the backend answers about by id, which is what makes the
    // record the store kept a session its successor can start again.
    sdk.sessions.push({ sessionId: 'waiting', summary: 'Waiting', lastModified: Date.now(), cwd: root });

    // A successor over the same store: the wake, and the person it belongs to,
    // are read back off the record rather than remembered.
    const { host: after, time } = hosting({ member: MEMBER, other: MEMBER }, { sessions: fileSessions({ dir }) });
    const { client: member } = await signing(after, 'member');
    // Somebody else's session, to tell the person apart from the host itself:
    // a member may write a session and may not delete another person's.
    const { client: other } = await signing(after, 'other');
    const theirs = await opening(other, 'theirs');

    // Due only now, and the member is here to carry it.
    time.pass(2);
    await settle(8);
    const woken = sessionQueries().length - 1;
    // The turn the wake began is the member's: a write the member may make is
    // made, and one the member may not is refused as the member is refused it.
    expect(said(await call('rename_chat', { title: 'Woken' }, woken))).toBe('Renamed chat to "Woken".');
    expect(said(await call('delete_session', { session: theirs.held }, woken)))
      .toBe("Only the session's owner can delete it.");
  });

  it('asks nobody where there is no users directory, and the tools act as they did', async () => {
    const time = clock();
    const host = createHost({
      path: root, agents: [claude({ paths: [root] })], ...machine(), tools: hostTools(),
      now: time.now, timer: time.timer, sleepAfterMinutes: 0,
    });
    const client = host.accept(peer());
    await hello(client);
    const solo = await opening(client, 'solo');
    // No turn is running and no grant is asked: the calls the turn with no
    // person was refused above are answered here, as they were before there
    // was anybody to ask.
    expect(said(await call('rename_chat', { title: 'Renamed' }, 0))).toBe('Renamed chat to "Renamed".');
    expect(said(await call('create_session', { relationship: 'currentSession', title: 'x', prompt: 'y' }, 0)))
      .toMatch(/^Chat created in the current session/);
    expect(said(await call('schedule_wakeup', { delaySeconds: 60, prompt: 'later' }, 0))).toContain('Wakeup scheduled');

    time.pass(2);
    await settle(8);
    // The turn the wake began is nobody's too, and writes as it always did.
    expect(said(await call('rename_chat', { title: 'Woken' }, 0))).toBe('Renamed chat to "Woken".');
    const rows = JSON.parse(said(await call('list_sessions', {}, 0))) as { sessions: { session: string }[] };
    expect(rows.sessions.map((one) => one.session)).toContain(solo.held);
  });
});

/*
 * The bounds VS Code's own tool group puts on spawning and messaging.
 *
 * Four numbers, kept as the reference host keeps them: a chain of sessions
 * stops three deep, one tree may make fifty sessions and fifty chats, and its
 * tools may send a hundred messages. What differs is only whose budget a count
 * spends. VS Code keeps its three counters in one process, shared by every
 * session and every person on it; here they are kept per session tree, so a
 * runaway agent exhausts its own tree and not the host, and a second tree
 * starts from nothing.
 *
 * There is no users directory below, so no grant is asked and none of this is
 * about a person: these cases are the limits on their own.
 */
describe("VS Code's limits on spawning and messaging", () => {
  type Answer = { content: { text: string }[]; isError?: boolean };
  type Tool = { name: string; handler: (input: unknown) => Promise<Answer> };
  type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

  /** One session's tools, as the model of the session at `index` reaches them. */
  const toolsOf = (index: number): Record<string, Tool> => {
    const servers = sessionQueries().at(index)?.options.mcpServers as Record<string, { tools: Tool[] }> | undefined;
    return Object.fromEntries((servers?.ahp?.tools ?? []).map((one) => [one.name, one]));
  };
  const call = async (name: string, input: unknown, index: number): Promise<Answer> => {
    const tool = toolsOf(index)[name];
    if (!tool) throw new Error(`no ${name}`);
    return tool.handler(input);
  };
  // A refusal is a tool result too: the backend hands the model the message as
  // text, marked as an error, which is how a model hears what it got wrong.
  const said = (one: Answer): string => one.content[0]?.text ?? '';

  /** A host with nobody to ask, and a client on it. */
  const top = async (): Promise<Client> => {
    const host = createHost({
      path: root, agents: [claude({ paths: [root] })], ...machine(), tools: hostTools(),
      sleepAfterMinutes: 0,
    });
    const client = host.accept(peer());
    await hello(client);
    return client;
  };

  /**
   * A session on this host, and the tools its own model reaches.
   *
   * `at` is the CLI that session was handed, which is how a case says whose
   * tools are making a call: one CLI per session started, in the order they
   * were started, so the newest is `sessionQueries().length - 1`.
   */
  const started = async (client: Client, name: string): Promise<{ held: string; at: number }> => {
    await client.handle({ method: 'createSession', params: { channel: `ahp-session:/${name}`, provider: 'claude' } });
    await settle(8);
    return { held: `ahp-session:/${name}`, at: sessionQueries().length - 1 };
  };

  /** One session's tools make another, whose own tools are then the newest. */
  const spawn = async (at: number, title: string): Promise<Answer> => {
    const answer = await call('create_session', {
      relationship: 'independent', workspace: root, title, prompt: 'work', worktree: false,
    }, at);
    await settle(8);
    return answer;
  };

  /** One session's tools send a message to another, which is where a send goes. */
  const telling = (at: number, to: string, message: string): Promise<Answer> =>
    call('send_message', { session: to, message }, at);

  it("stops a chain of sessions at spawn depth 3, in the reference host's words", async () => {
    const client = await top();
    const first = await started(client, 'first');
    /*
     * Three links down. The session asked is the one whose tools make the call,
     * so each step moves to the newest CLI: `first` at depth 0 makes `second`
     * at 1, that one makes `third` at 2, and `fourth` at 3 is the last one
     * allowed - a session three deep may not make another.
     */
    let at = first.at;
    for (const title of ['second', 'third', 'fourth']) {
      expect(said(await spawn(at, title)), title).toMatch(/^New session created \(/);
      at = sessionQueries().length - 1;
    }

    const refused = await spawn(at, 'fifth');
    expect(said(refused)).toBe(
      'Refusing to create a session: recursion limit reached (max spawn depth 3).'
      + ' This session was itself created 3 level(s) deep.',
    );
    expect(refused.isError).toBe(true);
  });

  it('refuses the 51st session in one tree, and still makes one in a second', async () => {
    const client = await top();
    const first = await started(client, 'first');
    for (let i = 0; i < 50; i++) {
      expect(said(await spawn(first.at, `made ${i}`)), `made ${i}`).toMatch(/^New session created \(/);
    }

    const refused = await spawn(first.at, 'one more');
    expect(said(refused)).toBe('Refusing to create more than 50 sessions from server tools in this session tree.');
    expect(refused.isError).toBe(true);

    // A second tree is a session nothing started, and its budget is its own.
    // That is the whole of what keeping the counts per tree buys: one session's
    // runaway agent does not spend what another session may make.
    const elsewhere = await started(client, 'elsewhere');
    expect(said(await spawn(elsewhere.at, 'its own child'))).toMatch(/^New session created \(/);
  });

  it('refuses the 51st chat in one tree, by either tool that makes one', async () => {
    const client = await top();
    const first = await started(client, 'first');
    for (let i = 0; i < 50; i++) {
      expect(said(await call('create_chat', { prompt: `word ${i}` }, first.at)), `word ${i}`).toMatch(/^Chat created \(/);
    }

    const refused = await call('create_chat', { prompt: 'one more' }, first.at);
    expect(said(refused)).toBe('Refusing to create more than 50 chats from server tools in this session tree.');
    expect(refused.isError).toBe(true);

    // `create_session` with `currentSession` makes a chat too, and spends the
    // same budget. The reference host counts them as one, and so does this.
    expect(said(await call('create_session', { relationship: 'currentSession', title: 'x', prompt: 'y' }, first.at)))
      .toBe('Refusing to create more than 50 chats from server tools in this session tree.');
  });

  it('refuses the 101st message sent through the tools', async () => {
    const client = await top();
    const from = await started(client, 'from');
    const to = await started(client, 'to');
    // The first message starts a turn in the target session and the rest are
    // queued behind it, which is one of the two ways a send is answered: both
    // are messages the host took, and both count.
    for (let i = 0; i < 100; i++) {
      expect(said(await telling(from.at, to.held, `word ${i}`)), `word ${i}`).toMatch(/^Message (sent|queued) \(/);
    }

    const refused = await telling(from.at, to.held, 'one more');
    expect(said(refused)).toBe('Refusing to send more than 100 messages from server tools in this session tree.');
    expect(refused.isError).toBe(true);
  });

  it('does not count a send that failed', async () => {
    const client = await top();
    const from = await started(client, 'from');
    const to = await started(client, 'to');
    /*
     * A link naming a chat the target session does not run. The message gets
     * past the input and reaches the host, which is where the count would have
     * been taken - and a refusal is not a message sent, so the sender's tree
     * keeps its whole budget. Counted before the send instead, that tree would
     * refuse the hundredth message below.
     */
    const missed = await telling(from.at, openLink(to.held, 'claude', 'nope'), 'nowhere');
    expect(missed.isError).toBe(true);
    expect(said(missed)).toContain('is not a session this host is running');

    for (let i = 0; i < 100; i++) {
      expect(said(await telling(from.at, to.held, `word ${i}`)), `word ${i}`).toMatch(/^Message (sent|queued) \(/);
    }
    expect(said(await telling(from.at, to.held, 'one more')))
      .toBe('Refusing to send more than 100 messages from server tools in this session tree.');
  });

  it('counts messages sent to any session against the sender, not the target', async () => {
    const client = await top();
    const from = await started(client, 'from');
    const one = await started(client, 'one');
    const two = await started(client, 'two');
    /*
     * Two sessions in trees of their own, neither of them the sender's. Counted
     * where the message lands, each would hold its own budget of a hundred, and
     * an agent could send a hundred into every session it can name and never
     * meet a limit. The count is taken against the session the call is made
     * from, so the hundred is the sender's however many sessions it spends them
     * in - and it is that session's tree the refusal names.
     */
    for (let i = 0; i < 50; i++) {
      expect(said(await telling(from.at, one.held, `to one, ${i}`)), `to one, ${i}`)
        .toMatch(/^Message (sent|queued) \(/);
      expect(said(await telling(from.at, two.held, `to two, ${i}`)), `to two, ${i}`)
        .toMatch(/^Message (sent|queued) \(/);
    }

    const refused = await telling(from.at, two.held, 'one more');
    expect(said(refused)).toBe('Refusing to send more than 100 messages from server tools in this session tree.');
    expect(refused.isError).toBe(true);
    // And the sessions it was writing into are untouched by the refusal: what
    // ran out is the sender's budget, not theirs.
    expect(said(await telling(two.at, from.held, 'and back again'))).toMatch(/^Message (sent|queued) \(/);
  });
});

/*
 * A chat a tool opens on a backend of its own.
 *
 * `createChat` names the backend that serves the one chat where the session's
 * own is not the one wanted - a bot's Back chat running a harness the Front
 * does not - and the same road a plugin's `startChat` takes. The session goes
 * on being served by its own provider; what changes is that this chat's
 * conversation belongs to another.
 */
describe('a chat opened on a backend of its own', () => {
  type Answer = { content: { text: string }[]; isError?: boolean };
  type Tool = { name: string; handler: (input: unknown) => Promise<Answer> };
  type Client = ReturnType<ReturnType<typeof createHost>['accept']>;
  type State = { snapshot: { state: { provider?: string; chats: { resource: string }[] } } };

  /**
   * A second backend, recording every chat it is asked to start.
   *
   * Echo rather than the fake Claude: what is under test is which agent the
   * chat is handed to, and a backend that answers with its own record says
   * that without a turn having to run. `voice` is a key of its own, so a
   * config checked against *this* schema can be told from one checked against
   * the session's.
   */
  const other = (starts: Start[]): Agent => {
    const base = echo({ path: root, pace: 0 });
    return {
      ...base,
      provider: 'other',
      schema: () => {
        const schema = base.schema();
        const properties = { ...(schema.properties as Record<string, Record<string, unknown>>) };
        properties.voice = { type: 'string', title: 'Voice', scope: 'session' };
        return { ...schema, properties };
      },
      create: (start: Start) => { starts.push(start); return base.create(start); },
    };
  };

  /**
   * A tool that opens a chat the way a plugin's own tool would.
   *
   * `create_chat` itself names no backend: a model adds another conversation
   * of the session it is in, and the backend is the plugin's business. This is
   * the seam a plugin's tool reaches, so it is the seam a case calls.
   */
  const MAKER: HostTool = {
    definition: {
      name: 'make_chat',
      title: 'Make Chat',
      description: 'Open a chat in this session, on the backend it names.',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'The backend that serves the chat.' },
          config: { type: 'object', description: 'That backend\'s settings for it.' },
          prompt: { type: 'string', description: 'What to say in it first.' },
        },
        required: ['prompt'],
      },
    },
    run: async (input, at) => {
      const made = await at.createChat(at.session, {
        prompt: String(input.prompt),
        from: { origin: { kind: 'agent' } },
        ...(typeof input.provider === 'string' ? { provider: input.provider } : {}),
        ...(typeof input.config === 'object' && input.config !== null
          ? { config: input.config as Record<string, unknown> }
          : {}),
      });
      return `opened ${made.chat}`;
    },
  };

  /** One session on the fake Claude, with `make_chat` among its tools. */
  const opened = async (starts: Start[]): Promise<{ client: Client; call: (input: unknown) => Promise<Answer> }> => {
    const host = createHost({
      path: root,
      agents: [claude({ paths: [root] }), other(starts)],
      ...machine(),
      tools: [...hostTools(), MAKER],
      sleepAfterMinutes: 0,
    });
    const client = host.accept(peer());
    await hello(client);
    // A machine of the session's own, and a key its own backend declares: what
    // reaches a chat of another backend and what must not is read off these.
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/mine', provider: 'claude', config: { computer: '', permissionMode: 'plan' } },
    });
    await settle(8);
    const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: Tool[] }> | undefined;
    const tool = servers?.ahp?.tools.find((one) => one.name === 'make_chat') as Tool | undefined;
    if (tool === undefined) throw new Error('no make_chat');
    return { client, call: (input) => tool.handler(input) };
  };

  const state = async (client: Client): Promise<State['snapshot']['state']> =>
    (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/mine' } }) as State).snapshot.state;

  it('starts the chat on the backend it names, with that backend\'s config', async () => {
    const starts: Start[] = [];
    const { client, call } = await opened(starts);
    const made = await call({ provider: 'other', config: { voice: 'loud' }, prompt: 'say hi' });
    expect(made.isError).toBeFalsy();
    const chatUri = /^opened (ahp-chat:\/[0-9a-f-]+)$/.exec(made.content[0]?.text ?? '')?.[1];
    expect(chatUri).toBeDefined();

    // Started on the other backend, and handed what it was asked for.
    expect(starts).toHaveLength(1);
    expect(starts[0]?.settings).toMatchObject({ voice: 'loud' });
    // The session's machine reaches it, because no backend owns `computer`.
    expect(starts[0]?.settings.computer).toBe('');
    // The session backend's own settings do not: `permissionMode` is Claude's
    // and means nothing to a harness asked for this chat.
    expect(starts[0]?.settings).not.toHaveProperty('permissionMode');

    // The session is still Claude's, and the chat is one of its own.
    const after = await state(client);
    expect(after.provider).toBe('claude');
    expect(after.chats.map((one) => one.resource)).toContain(chatUri);
  });

  it('refuses a backend this host does not have, and makes no chat', async () => {
    const starts: Start[] = [];
    const { client, call } = await opened(starts);
    const before = (await state(client)).chats.length;
    const refused = await call({ provider: 'nobody', prompt: 'say hi' });
    expect(refused.isError).toBe(true);
    expect(refused.content[0]?.text).toBe('No provider called nobody');
    expect(starts).toHaveLength(0);
    // Nothing was announced and nothing was started: the session has the chats
    // it had.
    expect((await state(client)).chats).toHaveLength(before);
  });
});

/*
 * A tool a person calls with no session behind it.
 *
 * The other place a host tool runs: a window asks the host what a person may do
 * before any chat exists, so a tool that says `sessionless` is bound to a caller
 * instead of to a session. What these cases check is the list one caller is
 * offered, and that a tool called from it acts as that caller - the session it
 * makes is theirs, the turn it begins is theirs, and the event says so.
 */
describe('a tool a person calls with no session', () => {
  type Tool = { name: string; handler: (input: unknown) => Promise<{ content: { text: string }[]; isError?: boolean }> };

  /** The read half of sessions and the write half, as the cases above hold them. */
  const MEMBER: Grant[] = ['session:read', 'session:write'];
  /** The read half alone, which is all a guest holds. */
  const GUEST: Grant[] = ['session:read'];

  /** A loader context for the probe plugin, which reads no files. */
  const loader = (): LoaderContext => ({
    path: root, paths: [root], version: sdkVersion(), hostName: 'test', configDir: root, log: () => {}, say: () => {},
  });

  /**
   * A host with a written store, so ownership can be read back from it, and the
   * two people these cases name. `contribution` adds a plugin's read of the
   * host's events, which is how a case watches `tool_call`.
   */
  const hosting = (more: HostTool[] = [], contribution?: Contribution, agents?: Agent[]) => {
    // A third person holding the grant a root config push needs, so a case can
    // set the operator's rule the way a window does.
    const users = directory({ member: MEMBER, guest: GUEST, owner: ['config:change'] });
    const store = fileSessions({ dir: join(root, 'sessions') });
    const base: HostOptions = {
      path: root, agents: agents ?? [claude({ paths: [root] })], ...machine(),
      users, sessions: store, tools: [...hostTools(), ...more], sleepAfterMinutes: 0,
    };
    return { host: createHost(contribution === undefined ? base : foldHostOptions(base, [contribution]).options), users, store };
  };

  /** One person, as the directory answers them. */
  const principal = async (users: Users, token: string): Promise<Principal> => {
    const person = await users.verify(token);
    if (person === undefined) throw new Error(`the directory does not know ${token}`);
    return person;
  };

  /** The tools bound for one caller, by name. */
  const offered = (host: ReturnType<typeof createHost>, caller: ToolCaller): Record<string, BoundTool> =>
    Object.fromEntries(host.sessionlessTools(caller).map((one) => [one.definition.name, one]));

  /** One call, as a door that serves this list would make it. */
  const run = async (
    host: ReturnType<typeof createHost>, caller: ToolCaller, name: string, input: Record<string, unknown>,
  ): Promise<string> => {
    const tool = offered(host, caller)[name];
    if (tool?.run === undefined) throw new Error(`no ${name} for this caller`);
    return await tool.run(input);
  };

  it('offers a member the seven session tools, and a guest only the two it may read', async () => {
    const { host, users } = hosting();
    const seven = [
      'list_sessions', 'create_session', 'create_chat', 'rename_chat', 'send_message', 'get_session_context', 'delete_session',
    ];
    expect(Object.keys(offered(host, { principal: await principal(users, 'member') }))).toEqual(seven);
    expect(Object.keys(offered(host, { principal: await principal(users, 'guest') })))
      .toEqual(['list_sessions', 'get_session_context']);
    // This host's own connection is refused nothing it asks about, either.
    expect(Object.keys(offered(host, { root: true }))).toEqual(seven);
  });

  it('leaves out a tool that says nothing, and an advanced one while the host forbids them', async () => {
    const plain: HostTool = {
      definition: { name: 'plain_tool', title: 'Plain', description: 'Not offered to a person.', inputSchema: { type: 'object', properties: {} } },
      run: () => 'plain',
    };
    const advanced: HostTool = {
      definition: { name: 'advanced_tool', title: 'Advanced', description: 'Advanced, and sessionless.', inputSchema: { type: 'object', properties: {} } },
      sessionless: true,
      advancedPermission: true,
      run: () => 'advanced',
    };
    const { host, users } = hosting([plain, advanced]);
    const names = Object.keys(offered(host, { principal: await principal(users, 'member') }));
    expect(names).not.toContain('plain_tool');
    expect(names).not.toContain('advanced_tool');
    expect(names).toHaveLength(7);
  });

  it('refuses a tool the operator\'s rule names, before the tool runs', async () => {
    const calls: string[] = [];
    const probe = (name: string): HostTool => ({
      definition: { name, title: name, description: `${name}, and sessionless.`, inputSchema: { type: 'object', properties: {} } },
      sessionless: true,
      run: () => { calls.push(name); return name; },
    });
    const { host, users } = hosting([probe('notify'), probe('ping')]);
    const client = host.accept(peer());
    await hello(client);
    await signIn(client, 'owner');
    await client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config: { eligibleForAutoApproval: { 'ahp/notify': false } } } },
    });
    await settle();
    const member = await principal(users, 'member');

    await expect(run(host, { principal: member }, 'notify', {})).rejects.toThrow('eligibleForAutoApproval');
    // The rule is read before the tool's own work, and a tool it does not name runs.
    expect(calls).toEqual([]);
    expect(await run(host, { principal: member }, 'ping', {})).toBe('ping');
    expect(calls).toEqual(['ping']);
  });

  it('makes a session the caller owns, with no parent, when it is independent', async () => {
    const { host, users, store } = hosting();
    const said = await run(host, { principal: await principal(users, 'member') }, 'create_session', {
      relationship: 'independent', prompt: 'say hi', title: 'Made by a person',
      workspace: uriOf(root), worktree: false,
    });
    const id = /^New session created \(agent-host-session:\/\/claude\/([^)]+)\)\.$/.exec(said)?.[1];
    expect(id).toBeDefined();
    expect(store.owner(id as string)).toBe('user:member');
    expect(store.parent?.(id as string)).toBeUndefined();
  });

  it('refuses a chat in the calling session when the call has none', async () => {
    const { host, users } = hosting();
    await expect(run(host, { principal: await principal(users, 'member') }, 'create_session', {
      relationship: 'currentSession', prompt: 'say hi', title: 'Nowhere',
    })).rejects.toThrow('currentSession needs a calling session; use independent');
  });

  it('refuses a chat in a session the call did not name', async () => {
    const { host, users } = hosting();
    await expect(run(host, { principal: await principal(users, 'member') }, 'create_chat', { prompt: 'say hi' }))
      .rejects.toThrow('Invalid create_chat input: session is required when there is no calling session.');
  });

  it('begins a turn as the caller for a message a person sends', async () => {
    const { host, users } = hosting();
    const member = await principal(users, 'member');
    // One session, opened by the member the ordinary way, so the turn the
    // message begins carries a person this host met when they signed in.
    const client = host.accept(peer());
    await hello(client, 'member');
    await signIn(client, 'member');
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/inbox', provider: 'claude' } });
    await settle(8);
    await run(host, { principal: member }, 'send_message', { session: 'ahp-session:/inbox', message: 'take a look' });
    await settle(8);
    // The session's own tools run in the turn that message began, so a write
    // through them is allowed only where the turn's sender is the member.
    const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: Tool[] }> | undefined;
    const rename = servers?.ahp?.tools.find((one) => one.name === 'rename_chat');
    if (rename === undefined) throw new Error('no rename_chat');
    const answered = await rename.handler({ title: 'Woken by a person' });
    expect(answered.isError).toBeFalsy();
  });

  it('says who made the call, and that no session did', async () => {
    const seen: HostEvent[] = [];
    const { host: plugin, contribution } = pluginHost('probe', loader());
    plugin.on('tool_call', (event) => { seen.push(event); });
    const { host, users } = hosting([], contribution);
    await run(host, { principal: await principal(users, 'member') }, 'list_sessions', {});
    await settle(8);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ type: 'tool_call', person: 'member', tool: 'list_sessions', ok: true });
    expect(seen[0]).not.toHaveProperty('session');
    expect(seen[0]).not.toHaveProperty('chat');
  });

  /** A backend offering the models these cases share with the first. */
  const backend = (provider: string, starts: Start[]): Agent => {
    const models = [
      { id: 'shared-model', name: 'Shared model' },
      ...(provider === 'claude' ? [{ id: 'claude-model', name: 'Claude model' }] : [{ id: 'other-model', name: 'Other model' }]),
    ];
    const base = claude({ paths: [root], models });
    return { ...base, provider, create: (start: Start) => { starts.push(start); return base.create(start); } };
  };

  /** The two backends, both offering `shared-model`, recording what starts on the second. */
  const pair = (starts: Start[]): Agent[] => [backend('claude', []), backend('other', starts)];

  it('starts a new session on the agent it names, where two agents offer one model', async () => {
    const starts: Start[] = [];
    const { host, users } = hosting([], undefined, pair(starts));
    // The models are learned by a probe, which answers after the host is built.
    await settle(8);
    const said = await run(host, { principal: await principal(users, 'member') }, 'create_session', {
      relationship: 'independent', prompt: 'say hi', title: 'On the other one',
      workspace: uriOf(root), worktree: false, agent: 'other', model: 'shared-model',
    });
    expect(said).toMatch(/^New session created \(agent-host-session:\/\/other\/[^)]+\)\.$/);
    expect(starts).toHaveLength(1);
    expect(starts[0]?.settings).toMatchObject({ model: 'shared-model' });
  });

  it('refuses an agent this host does not offer, and names the ones it does', async () => {
    const starts: Start[] = [];
    const { host, users } = hosting([], undefined, pair(starts));
    await settle(8);
    await expect(run(host, { principal: await principal(users, 'member') }, 'create_session', {
      relationship: 'independent', prompt: 'say hi', title: 'Nowhere',
      workspace: uriOf(root), worktree: false, agent: 'nobody',
    })).rejects.toThrow('Invalid create_session input: agent "nobody" is not one this host offers; it offers claude, other.');
    expect(starts).toHaveLength(0);
  });

  it('refuses a model the agent it names does not offer', async () => {
    const starts: Start[] = [];
    const { host, users } = hosting([], undefined, pair(starts));
    await settle(8);
    await expect(run(host, { principal: await principal(users, 'member') }, 'create_session', {
      relationship: 'independent', prompt: 'say hi', title: 'Wrong model',
      workspace: uriOf(root), worktree: false, agent: 'other', model: 'claude-model',
    })).rejects.toThrow('Invalid create_session input: model "claude-model" is not one this host offers for other.');
  });

  it('gives a new session its settings, and refuses what its agent does not take', async () => {
    const starts: Start[] = [];
    const { host, users } = hosting([], undefined, pair(starts));
    await settle(8);
    const member = { principal: await principal(users, 'member') };
    await run(host, member, 'create_session', {
      relationship: 'independent', prompt: 'say hi', title: 'Configured',
      workspace: uriOf(root), worktree: false, agent: 'other', config: { permissionMode: 'plan' },
    });
    expect(starts).toHaveLength(1);
    expect(starts[0]?.settings).toMatchObject({ permissionMode: 'plan' });
    await expect(run(host, member, 'create_session', {
      relationship: 'independent', prompt: 'say hi', title: 'Refused',
      workspace: uriOf(root), worktree: false, agent: 'other', config: { permissionMode: 'nonsense' },
    })).rejects.toThrow('permissionMode "nonsense" is not a value other takes');
    await expect(run(host, member, 'create_session', {
      relationship: 'independent', prompt: 'say hi', title: 'Refused',
      workspace: uriOf(root), worktree: false, config: 'loud',
    })).rejects.toThrow('Invalid create_session input: config must be an object.');
  });

  it('opens a chat of the agent it names in the session it is called from', async () => {
    const starts: Start[] = [];
    const { host } = hosting([], undefined, pair(starts));
    const client = host.accept(peer());
    await hello(client, 'member');
    await signIn(client, 'member');
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/mine', provider: 'claude' } });
    const chat = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/mine' } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    // A turn the member sent, which is where a session tool reads its person.
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle(8);
    const servers = sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: Tool[] }> | undefined;
    const create = servers?.ahp?.tools.find((one) => one.name === 'create_session');
    if (create === undefined) throw new Error('no create_session');
    const made = await create.handler({
      relationship: 'currentSession', prompt: 'say hi', title: 'Another backend', agent: 'other',
    });
    expect(made.isError).toBeFalsy();
    expect(starts).toHaveLength(1);
    // The session keeps the backend it had; the chat is the other one's.
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/mine' } }) as {
      snapshot: { state: { provider?: string; chats: { resource: string }[] } };
    }).snapshot.state;
    expect(state.provider).toBe('claude');
    expect(state.chats).toHaveLength(2);
  });
});
