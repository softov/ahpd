import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import type { Bag, Session, Start } from '@ahpd/sdk';
import {
  DEFAULT_TOOLS,
  PERMISSION_MODES,
  cofoldAgent,
  toolsOf,
} from '../src/index.js';
import type { CofoldOptions, ToolsConfig } from '../src/index.js';

/*
 * The four capabilities a cofold session runs itself.
 *
 * `@cofold/tools`' files, shell, web and memory are built into the agent this
 * backend creates, so a turn offers the model the tools a Claude session has.
 * Whatever runs is cofold's, in this process; what these check is the wiring
 * around it: which tools are offered, what a call is drawn as, that an edit is
 * reported to the changeset before and after it happens, and what each
 * permission mode does with each class of tool.
 *
 * No model and no network: the adapter is a script, the store is in a temp
 * directory, and the web capability's fetch is the stub below.
 */

type Script = Parameters<typeof createFakeModel>[0]['script'];

/** Waits for `check` to hold, turning the event loop, and throws once `ms` of wall-clock time has passed. */
const when = async (check: () => boolean, ms = 5000): Promise<void> => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out waiting');
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

/** A case's own limit, above `when`'s budget so a wait that runs out fails on its own message. */
vi.setConfig({ testTimeout: 30_000 });

/** A fixed number of turns of the event loop, so a run can settle into its pause. */
const settle = async (times = 20): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

type Note = { channel: 'session' | 'chat' | 'terminal'; action: Bag };

/** One session's channels, collected the way the host would dispatch them. */
function view(trace?: string[]) {
  const notes: Note[] = [];
  return {
    notes,
    emit: (channel: 'session' | 'chat' | 'terminal', action: Bag): void => {
      notes.push({ channel, action });
      trace?.push(`action:${String(action.type)}`);
    },
    of: (channel: string, type: string): Bag[] =>
      notes.filter((one) => one.channel === channel && one.action.type === type).map((one) => one.action),
  };
}

type View = ReturnType<typeof view>;

const ended = (v: View): boolean =>
  v.of('chat', 'chat/turnComplete').length > 0
  || v.of('chat', 'chat/turnCancelled').length > 0
  || v.of('chat', 'chat/error').length > 0;

const asked = (v: View): boolean => v.of('session', 'session/inputNeededSet').length > 0;

/** The completion a client draws for one call, or nothing while it has none. */
const completeFor = (v: View, callId: string): Bag | undefined =>
  v.of('chat', 'chat/toolCallComplete').find((action) => action.toolCallId === callId);

interface Edit { turnId: string; path: string; phase: 'before' | 'after' }

/** One session over a scripted model, with its channels and the edits it reported. */
async function open(args: {
  script: Script;
  workspace: string | undefined;
  store?: string;
  tools?: ToolsConfig;
  settings?: Record<string, unknown>;
  /** An ordered log of the actions emitted and the edits reported, for the order cases. */
  trace?: string[];
}) {
  const model = createFakeModel({ script: args.script, stream: true });
  const options: CofoldOptions = {
    adapter: model,
    ...(args.store === undefined ? { memory: true } : { store: args.store }),
    ...(args.tools === undefined ? {} : { tools: args.tools }),
  };
  const agent = cofoldAgent(options);
  const v = view(args.trace);
  const edits: Edit[] = [];
  const session: Session = agent.create({
    uri: 'ahp-session:/tools',
    chatUri: 'ahp-chat:/tools',
    settings: { ...agent.defaults(), ...(args.settings ?? {}) },
    workingDirectory: args.workspace,
    schema: () => agent.schema(),
    emit: v.emit,
    tools: [],
    onFileEdit: (turnId: string, path: string, phase: 'before' | 'after') => {
      edits.push({ turnId, path, phase });
      args.trace?.push(`edit:${phase}`);
    },
  } as unknown as Start);
  return { model, session, v, edits };
}

/** A directory a session can call its workspace, with a file the tools can read and change. */
const place = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-cofold-tools-'));
  writeFileSync(join(dir, 'a.txt'), 'hello world\n');
  return dir;
};

const call = (name: string, input: unknown) => ({ name, input, callId: 'c1' });

/** The names the model was offered on its first step. */
const offeredNames = (model: ReturnType<typeof createFakeModel>): string[] =>
  (model.requests[0]?.tools ?? []).map((one) => one.name).sort();

/* A stub so the web capability never reaches the network. */
let realFetch: typeof fetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('hello from the web', { status: 200, headers: { 'content-type': 'text/plain' } })) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

it('turns all four capabilities on by default, so the model is offered their nine tools', async () => {
  const dir = place();
  const { model, session, v } = await open({ script: [{ text: 'ok' }], workspace: dir, store: dir });
  session.begin('t1', 'hello');
  await when(() => ended(v));

  expect(DEFAULT_TOOLS).toEqual({ files: true, shell: true, web: true, memory: true });
  expect(offeredNames(model)).toEqual([
    'edit_file', 'list_files', 'memory_read', 'memory_write',
    'read_file', 'search_files', 'shell_exec', 'web_fetch', 'write_file',
  ]);
  rmSync(dir, { recursive: true, force: true });
});

it('turns one capability off with the tools option, and leaves the other three on', async () => {
  const dir = place();
  const { model, session, v } = await open({
    script: [{ text: 'ok' }],
    workspace: dir,
    store: dir,
    tools: { shell: false },
  });
  session.begin('t1', 'hello');
  await when(() => ended(v));

  const names = offeredNames(model);
  expect(names).not.toContain('shell_exec');
  expect(names).toContain('read_file');
  expect(names).toContain('web_fetch');
  expect(names).toContain('memory_write');
  rmSync(dir, { recursive: true, force: true });
});

it('offers web_search only when a search provider is configured', async () => {
  const dir = place();
  const plain = await open({ script: [{ text: 'ok' }], workspace: dir, store: dir });
  plain.session.begin('t1', 'hi');
  await when(() => ended(plain.v));
  expect(offeredNames(plain.model)).toContain('web_fetch');
  expect(offeredNames(plain.model)).not.toContain('web_search');

  const searching = await open({
    script: [{ text: 'ok' }],
    workspace: dir,
    store: dir,
    tools: { web: { search: { duckduckgo: true } } },
  });
  searching.session.begin('t1', 'hi');
  await when(() => ended(searching.v));
  const names = offeredNames(searching.model);
  expect(names).toContain('web_search');
  // The full ten only once a provider is there to answer one.
  expect(names).toHaveLength(10);
  rmSync(dir, { recursive: true, force: true });
});

it('asks the search providers in the order the configuration lists them', async () => {
  const dir = place();
  /*
   * Both providers answer, each in its own format, so which one is reached is
   * which one the capability tried first rather than which one was reachable.
   */
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    if (url.includes('duckduckgo.com')) {
      return new Response(
        '<a class="result__a" href="https://duck.example/">Duck result</a> <a class="result__snippet">from duck</a>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    }
    return new Response(
      JSON.stringify({ web: { results: [{ title: 'Brave result', url: 'https://brave.example/', description: 'from brave' }] } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;
  const { session, v } = await open({
    script: [{ toolCalls: [call('web_search', { query: 'cofold' })] }, { text: 'done' }],
    workspace: dir,
    store: dir,
    tools: { web: { search: { duckduckgo: true, brave: { apiKey: 'b' } } } },
    settings: { permissionMode: 'bypassPermissions' },
  });
  session.begin('t1', 'search it');
  await when(() => ended(v));

  const done = completeFor(v, 'c1');
  expect(done?.result).toMatchObject({ success: true });
  const content = JSON.stringify((done?.result as Bag).content);
  expect(content).toContain('Duck result');
  expect(content).not.toContain('Brave result');
  rmSync(dir, { recursive: true, force: true });
});

it('takes the tools option out of whatever a configuration named', () => {
  expect(toolsOf(undefined)).toBeUndefined();
  expect(toolsOf('nope')).toBeUndefined();
  expect(toolsOf({ files: false, shell: 'no', memory: true })).toEqual({ files: false, memory: true });
  expect(toolsOf({ web: false })).toEqual({ web: false });
  expect(toolsOf({ web: { search: { brave: { apiKey: 'b' }, tavily: { apiKey: 't' }, duckduckgo: true } } }))
    .toEqual({ web: { search: { brave: { apiKey: 'b' }, tavily: { apiKey: 't' }, duckduckgo: true } } });
  // A provider with no usable key names nothing, so `web_search` stays away.
  expect(toolsOf({ web: { search: { brave: {} } } })).toEqual({ web: {} });
  // The order the configuration lists the providers is the order they are tried.
  const ordered = toolsOf({ web: { search: { duckduckgo: true, brave: { apiKey: 'b' } } } }) as { web: { search: Record<string, unknown> } };
  expect(Object.keys(ordered.web.search)).toEqual(['duckduckgo', 'brave']);
});

it('reads a file through the files capability', async () => {
  const dir = place();
  const { session, v } = await open({
    script: [{ toolCalls: [call('read_file', { path: 'a.txt' })] }, { text: 'done' }],
    workspace: dir,
    store: dir,
  });
  session.begin('t1', 'read it');
  await when(() => ended(v));

  const done = completeFor(v, 'c1');
  expect(done?.result).toMatchObject({ success: true });
  expect((done?.result as Bag).content).toEqual([{ type: 'text', text: '1│hello world' }]);
  rmSync(dir, { recursive: true, force: true });
});

it('fetches a page through the web capability', async () => {
  const dir = place();
  const { session, v } = await open({
    script: [{ toolCalls: [call('web_fetch', { url: 'https://203.0.113.10/' })] }, { text: 'done' }],
    workspace: dir,
    store: dir,
  });
  session.begin('t1', 'fetch it');
  await when(() => ended(v));

  const done = completeFor(v, 'c1');
  expect(done?.result).toMatchObject({ success: true });
  expect(JSON.stringify((done?.result as Bag).content)).toContain('hello from the web');
  rmSync(dir, { recursive: true, force: true });
});

it('refuses to fetch an internal address, without reaching it', async () => {
  const dir = place();
  let reached = false;
  globalThis.fetch = (async () => { reached = true; return new Response('no', { status: 200 }); }) as typeof fetch;
  const { session, v } = await open({
    script: [{ toolCalls: [call('web_fetch', { url: 'http://127.0.0.1:1/' })] }, { text: 'done' }],
    workspace: dir,
    store: dir,
    settings: { permissionMode: 'bypassPermissions' },
  });
  session.begin('t1', 'fetch it');
  await when(() => ended(v));

  expect(completeFor(v, 'c1')?.result).toMatchObject({ success: false });
  // The address is refused before the request, so the stub never sees one.
  expect(reached).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

it('reports a file edit through onFileEdit, before and after, on the resolved path', async () => {
  const dir = place();
  const { session, v, edits } = await open({
    script: [{ toolCalls: [call('edit_file', { path: 'a.txt', old: 'world', new: 'there' })] }, { text: 'done' }],
    workspace: dir,
    store: dir,
    settings: { permissionMode: 'acceptEdits' },
  });
  session.begin('t1', 'edit it');
  await when(() => ended(v));

  expect(edits).toEqual([
    { turnId: 't1', path: join(dir, 'a.txt'), phase: 'before' },
    { turnId: 't1', path: join(dir, 'a.txt'), phase: 'after' },
  ]);
  expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('hello there\n');
  rmSync(dir, { recursive: true, force: true });
});

it('still sends the after when the person declines the edit', async () => {
  const dir = place();
  const { session, v, edits } = await open({
    script: [{ toolCalls: [call('write_file', { path: 'b.txt', content: 'new' })] }, { text: 'done' }],
    workspace: dir,
    store: dir,
    settings: { permissionMode: 'default' },
  });
  session.begin('t1', 'write it');
  await when(() => asked(v));
  // Announced as changing, and the tool has not run. The pause is given a
  // moment so the answer reaches a run that has really stopped waiting.
  expect(edits).toEqual([{ turnId: 't1', path: join(dir, 'b.txt'), phase: 'before' }]);
  await settle();

  session.confirm('c1', false);
  await when(() => ended(v));
  expect(edits.map((one) => one.phase)).toEqual(['before', 'after']);
  // The tool never ran, so the file it would have written is not there.
  expect(readdirSync(dir)).not.toContain('b.txt');
  rmSync(dir, { recursive: true, force: true });
});

it('sends a declined edit its after before the next ask', async () => {
  const dir = place();
  const { session, v, edits } = await open({
    script: [
      { toolCalls: [call('write_file', { path: 'b.txt', content: 'new' })] },
      { toolCalls: [{ name: 'write_file', input: { path: 'c.txt', content: 'newer' }, callId: 'c2' }] },
      { text: 'done' },
    ],
    workspace: dir,
    store: dir,
    settings: { permissionMode: 'default' },
  });
  session.begin('t1', 'write it');
  await when(() => asked(v));
  await settle();

  session.confirm('c1', false);
  /*
   * The run goes on to the second call, which asks. The declined file's `after`
   * is out by then and the run has not ended, so the end-of-run sweep, which a
   * paused run never reaches, is not what sent it.
   */
  await when(() => v.of('session', 'session/inputNeededSet').length >= 2);
  expect(v.of('session', 'session/inputNeededSet')).toHaveLength(2);
  expect(edits.filter((one) => one.path === join(dir, 'b.txt')).map((one) => one.phase)).toEqual(['before', 'after']);
  expect(ended(v)).toBe(false);

  session.close();
  rmSync(dir, { recursive: true, force: true });
});

it('draws a shell call as a terminal, with its command as the intention', async () => {
  const dir = place();
  const { session, v } = await open({
    script: [{ toolCalls: [call('shell_exec', { command: 'echo hi' })] }, { text: 'done' }],
    workspace: dir,
    store: dir,
    settings: { permissionMode: 'bypassPermissions' },
  });
  session.begin('t1', 'run it');
  await when(() => ended(v));

  const start = v.of('chat', 'chat/toolCallStart').find((action) => action.toolCallId === 'c1');
  expect(start?._meta).toEqual({ toolKind: 'terminal' });
  expect(start?.intention).toBe('echo hi');
  // The bare command, not the JSON object the model sent, so the row reads as
  // the command it runs.
  const ready = v.of('chat', 'chat/toolCallReady').find((action) => action.toolCallId === 'c1');
  expect(ready?.toolInput).toBe('echo hi');

  const turn = (session.chatState().turns as Bag[])[0] as Bag;
  const part = (turn.responseParts as Bag[]).find((one) => one.kind === 'toolCall' && (one.toolCall as Bag).toolCallId === 'c1');
  expect((part?.toolCall as Bag)._meta).toEqual({ toolKind: 'terminal' });
  expect((part?.toolCall as Bag).intention).toBe('echo hi');
  expect((part?.toolCall as Bag).toolInput).toBe('echo hi');
  expect(completeFor(v, 'c1')?.result).toMatchObject({ success: true });
  rmSync(dir, { recursive: true, force: true });
});

it('asks before a shell command and sends its bare command on the request', async () => {
  const dir = place();
  const { session, v } = await open({
    script: [{ toolCalls: [call('shell_exec', { command: 'echo hi' })] }, { text: 'done' }],
    workspace: dir,
    store: dir,
    settings: { permissionMode: 'default' },
  });
  session.begin('t1', 'run it');
  await when(() => asked(v));

  const request = v.of('session', 'session/inputNeededSet')[0]?.request as Bag;
  expect((request?.toolCall as Bag).toolInput).toBe('echo hi');
  expect(v.of('chat', 'chat/toolCallReady')[0]?.toolInput).toBe('echo hi');
  session.close();
  rmSync(dir, { recursive: true, force: true });
});

it('keeps memory files under the store root, by workspace, and out of the changeset', async () => {
  const dir = place();
  const workspace = mkdtempSync(join(tmpdir(), 'ahpd-cofold-workspace-'));
  const { session, v, edits } = await open({
    script: [{ toolCalls: [call('memory_write', { path: 'MEMORY.md', content: '- a fact' })] }, { text: 'done' }],
    workspace,
    store: dir,
    settings: { permissionMode: 'bypassPermissions' },
  });
  session.begin('t1', 'remember it');
  await when(() => ended(v));

  const roots = readdirSync(join(dir, 'memory'));
  expect(roots).toHaveLength(1);
  expect(readFileSync(join(dir, 'memory', roots[0] as string, 'MEMORY.md'), 'utf8')).toBe('- a fact');
  // A memory file is not a workspace edit, so nothing is reported as changing.
  expect(edits).toEqual([]);
  rmSync(dir, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

it('sends the after for a denied edit before the call completes', async () => {
  const dir = place();
  const trace: string[] = [];
  const { session, v } = await open({
    script: [{ toolCalls: [call('write_file', { path: 'b.txt', content: 'new' })] }, { text: 'done' }],
    workspace: dir,
    store: dir,
    settings: { permissionMode: 'plan' },
    trace,
  });
  session.begin('t1', 'write it');
  await when(() => ended(v));

  // `plan` denies the write, so the `after` comes from the denial; the end-of-run
  // sweep would only send it after the call's own completion.
  expect(trace.indexOf('edit:before')).toBeGreaterThan(-1);
  expect(trace.indexOf('edit:after')).toBeGreaterThan(trace.indexOf('edit:before'));
  expect(trace.indexOf('edit:after')).toBeLessThan(trace.indexOf('action:chat/toolCallComplete'));
  expect(readdirSync(dir)).not.toContain('b.txt');
  rmSync(dir, { recursive: true, force: true });
});

it('sends the after for an edit still waiting when the turn is cancelled', async () => {
  const dir = place();
  const { session, v, edits } = await open({
    script: [{ toolCalls: [call('write_file', { path: 'b.txt', content: 'new' })] }, { text: 'done' }],
    workspace: dir,
    store: dir,
    settings: { permissionMode: 'default' },
  });
  session.begin('t1', 'write it');
  await when(() => asked(v));
  expect(edits.map((one) => one.phase)).toEqual(['before']);
  // The pause is given a moment so the cancel reaches a run that has really stopped waiting.
  await settle();

  session.cancel('t1');
  await when(() => ended(v));
  expect(edits.map((one) => one.phase)).toEqual(['before', 'after']);
  expect(v.of('chat', 'chat/turnCancelled')).toHaveLength(1);
  rmSync(dir, { recursive: true, force: true });
});

it('kills a cancelled shell command and the child it started', async () => {
  const dir = place();
  const { session, v } = await open({
    script: [{ toolCalls: [call('shell_exec', { command: 'sleep 30 & echo $! > child.pid; wait' })] }, { text: 'done' }],
    workspace: dir,
    store: dir,
    settings: { permissionMode: 'bypassPermissions' },
  });
  session.begin('t1', 'run it');
  const pidFile = join(dir, 'child.pid');
  await when(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '');
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  expect(pid).toBeGreaterThan(0);

  session.cancel('t1');
  await when(() => ended(v));
  expect(v.of('chat', 'chat/turnCancelled')).toHaveLength(1);

  // The whole process group is killed, so the backgrounded child is gone too.
  const gone = async (): Promise<boolean> => {
    for (let i = 0; i < 100; i++) {
      try {
        process.kill(pid, 0);
      }
      catch {
        return true;
      }
      await new Promise((r) => { setTimeout(r, 20); });
    }
    return false;
  };
  expect(await gone()).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});

it('keeps the tools for a session with no working directory', async () => {
  const dir = place();
  const { model, session, v } = await open({
    script: [{ toolCalls: [call('shell_exec', { command: 'pwd' })] }, { text: 'done' }],
    workspace: undefined,
    store: dir,
    settings: { permissionMode: 'bypassPermissions' },
  });
  session.begin('t1', 'where am I');
  await when(() => ended(v));

  const names = offeredNames(model);
  expect(names).toContain('shell_exec');
  expect(names).toContain('read_file');
  const done = completeFor(v, 'c1');
  expect(done?.result).toMatchObject({ success: true });
  // No directory named, so the command runs in the daemon's own.
  expect(JSON.stringify((done?.result as Bag).content)).toContain(process.cwd());
  rmSync(dir, { recursive: true, force: true });
});

/*
 * The permission modes, one row per mode and tool class.
 *
 * The modes are cofold's, so the table is what `policyOf` does with the
 * effects and the path each capability tool declares: a read never asks, an
 * edit inside the workspace runs under `acceptEdits`, a shell always asks
 * until `bypassPermissions`, and `plan` refuses anything that changes
 * something.
 */
type Mode = (typeof PERMISSION_MODES)[number];
type Outcome = 'run' | 'ask' | 'deny';

interface Row {
  what: string;
  call(at: { workspace: string; away: string }): { name: string; input: unknown; callId: string };
  expect: Record<Mode, Outcome>;
}

const ROWS: Row[] = [
  {
    what: 'a read',
    call: () => call('read_file', { path: 'a.txt' }),
    expect: { default: 'run', acceptEdits: 'run', plan: 'run', auto: 'run', bypassPermissions: 'run', dontAsk: 'run' },
  },
  {
    what: 'a read outside the workspace',
    call: (at) => {
      writeFileSync(join(at.away, 'secret'), 'secret\n');
      return call('read_file', { path: join(at.away, 'secret') });
    },
    expect: { default: 'ask', acceptEdits: 'ask', plan: 'ask', auto: 'run', bypassPermissions: 'run', dontAsk: 'deny' },
  },
  {
    what: 'an edit inside the workspace',
    call: () => call('edit_file', { path: 'a.txt', old: 'world', new: 'there' }),
    expect: { default: 'ask', acceptEdits: 'run', plan: 'deny', auto: 'ask', bypassPermissions: 'run', dontAsk: 'deny' },
  },
  {
    what: 'an edit outside the workspace',
    call: (at) => call('write_file', { path: join(at.away, 'x.txt'), content: 'x' }),
    expect: { default: 'ask', acceptEdits: 'ask', plan: 'deny', auto: 'ask', bypassPermissions: 'run', dontAsk: 'deny' },
  },
  {
    what: 'an edit through a symlink out of the workspace',
    call: (at) => {
      symlinkSync(at.away, join(at.workspace, 'link'), 'dir');
      return call('write_file', { path: 'link/x.txt', content: 'x' });
    },
    expect: { default: 'ask', acceptEdits: 'ask', plan: 'deny', auto: 'ask', bypassPermissions: 'run', dontAsk: 'deny' },
  },
  {
    what: 'an edit through a dangling symlink whose target is outside',
    call: (at) => {
      symlinkSync(join(at.away, 'new.txt'), join(at.workspace, 'dl'));
      return call('write_file', { path: 'dl', content: 'x' });
    },
    expect: { default: 'ask', acceptEdits: 'ask', plan: 'deny', auto: 'ask', bypassPermissions: 'run', dontAsk: 'deny' },
  },
  {
    what: 'an edit through a dangling link whose target has .. after a symlink out of the workspace',
    call: (at) => {
      mkdirSync(join(at.away, 'sub'));
      symlinkSync(join(at.away, 'sub'), join(at.workspace, 'sublink'), 'dir');
      symlinkSync('sublink/../esc2.txt', join(at.workspace, 'trick'));
      return call('write_file', { path: 'trick', content: 'x' });
    },
    expect: { default: 'ask', acceptEdits: 'ask', plan: 'deny', auto: 'ask', bypassPermissions: 'run', dontAsk: 'deny' },
  },
  {
    what: 'a shell command',
    call: () => call('shell_exec', { command: 'true' }),
    expect: { default: 'ask', acceptEdits: 'ask', plan: 'deny', auto: 'ask', bypassPermissions: 'run', dontAsk: 'deny' },
  },
  {
    what: 'a web fetch',
    call: () => call('web_fetch', { url: 'https://203.0.113.10/' }),
    expect: { default: 'ask', acceptEdits: 'ask', plan: 'ask', auto: 'run', bypassPermissions: 'run', dontAsk: 'deny' },
  },
];

/** What one mode does with one call: does it run, does it ask, or is it refused. */
async function outcomeOf(mode: Mode, row: Row): Promise<Outcome> {
  const workspace = place();
  const away = mkdtempSync(join(tmpdir(), 'ahpd-cofold-away-'));
  const toolCall = row.call({ workspace, away });
  const { session, v } = await open({
    script: [{ toolCalls: [toolCall] }, { text: 'done' }],
    workspace,
    store: workspace,
    settings: { permissionMode: mode },
  });
  session.begin('t1', 'go');
  await when(() => ended(v) || asked(v));
  const paused = asked(v);
  const completion = completeFor(v, toolCall.callId);
  const outcome: Outcome = paused
    ? 'ask'
    : completion !== undefined && (completion.result as Bag).success === true ? 'run' : 'deny';
  // A paused run is stopped rather than left waiting on a person who is not there.
  if (paused) session.close();
  rmSync(workspace, { recursive: true, force: true });
  rmSync(away, { recursive: true, force: true });
  return outcome;
}

it.each(ROWS.map((row) => [row.what, row] as const))('%s: every mode answers as the table says', async (_what, row) => {
  for (const mode of PERMISSION_MODES) {
    const got = await outcomeOf(mode, row);
    expect(got, `${row.what} under ${mode}`).toBe(row.expect[mode]);
  }
});
