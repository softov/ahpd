import { describe, expect, it } from 'vitest';
import { Status } from '../packages/sdk/src/catalog.js';
import {
  filterSessions, openLink, serializeContext, serializeSession, sessionMeant, sessionTools, statusWords,
} from '../packages/sdk/src/sessiontools.js';
import type { Summary } from '../packages/sdk/src/types/catalog.js';

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
});
