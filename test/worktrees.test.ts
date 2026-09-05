import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../examples/echo/agent.js';
import { gitWorktrees, worktreesOf } from '../src/worktrees.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * A working tree of a session's own.
 *
 * Against a real repository rather than a scripted port, because the whole
 * question is what `git worktree` does: whether the branch is the session's,
 * whether the files a checkout leaves behind arrive, and whether a tree with
 * somebody's uncommitted work in it survives the session that made it. None of
 * that is answerable against a fake that says yes.
 */

let made: string[] = [];

afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

/** A repository with one commit, a branch, and a file git was told to ignore. */
function repository(): string {
  // Two levels, so the `<repo>.worktrees` sibling is inside the served root
  // rather than beside it - which is the arrangement a host has to serve.
  const root = mkdtempSync(join(tmpdir(), 'ahpd-wt-'));
  made.push(root);
  const dir = join(root, 'project');
  mkdirSync(dir);
  const run = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'test@example.com');
  run('config', 'user.name', 'Test');
  writeFileSync(join(dir, 'tracked.txt'), 'tracked\n');
  writeFileSync(join(dir, '.gitignore'), '.env\n');
  writeFileSync(join(dir, '.env'), 'SECRET=1\n');
  run('add', '-A');
  run('commit', '-q', '-m', 'first');
  run('branch', 'release');
  return root;
}

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

const serving = (root: string) => createHost({
  path: root,
  agents: [echo({ path: join(root, 'project'), pace: 0 })],
  worktrees: gitWorktrees(),
});

const joined = async (root: string) => {
  const held = serving(root);
  const p = peer();
  const client = held.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  return { host: held, client, peer: p };
};

const project = (root: string) => join(root, 'project');

/** Read the session back until it says what the test is waiting for. */
type Held = { config: { values: Record<string, string> }; workingDirectories?: string[] };
const until = async (
  client: Awaited<ReturnType<typeof joined>>['client'],
  uri: string,
  done: (state: Held) => boolean,
): Promise<Held> => {
  for (let tries = 0; tries < 100; tries++) {
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: Held };
    }).snapshot.state;
    if (done(state)) return state;
    await new Promise((resolve) => { setTimeout(resolve, 20); });
  }
  throw new Error(`${uri} never got there`);
};

describe('a session with a working tree of its own', () => {
  it('offers the choice only where there is a repository to make one in', async () => {
    const root = repository();
    const { client } = await joined(root);
    const offered = await client.handle({
      method: 'resolveSessionConfig',
      params: { channel: 'ahp-root://', provider: 'echo', workingDirectories: [`file://${project(root)}`] },
    }) as { schema: { properties: Record<string, { enum?: string[] }> }; values: Record<string, string> };
    expect(offered.schema.properties.isolation?.enum).toEqual(['folder', 'worktree']);
    // The branches it actually has, with the one it is on first: a picker that
    // opens on the oldest branch is one somebody has to search.
    expect(offered.schema.properties.branch?.enum).toContain('release');
    // `folder`, because every session this daemon has run has been one, and a
    // default that moved them all would be changing where an agent works
    // without being asked.
    expect(offered.values.isolation).toBe('folder');

    const plain = mkdtempSync(join(tmpdir(), 'ahpd-plain-'));
    made.push(plain);
    const bare = await joined(plain);
    const nothing = await bare.client.handle({
      method: 'resolveSessionConfig',
      params: { channel: 'ahp-root://', provider: 'echo', workingDirectories: [`file://${plain}`] },
    }) as { schema: { properties?: Record<string, unknown> } };
    // Not a repository, so there is no isolation to offer and the control is
    // absent rather than present with one value.
    expect(nothing.schema.properties?.isolation).toBeUndefined();
  });

  it('makes a worktree on a branch of its own, and runs the session there', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/isolated';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri,
        provider: 'echo',
        workingDirectories: [`file://${project(root)}`],
        config: { isolation: 'worktree', branch: 'main' },
      },
    });
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    const where = state.workingDirectories[0]?.replace('file://', '') ?? '';
    expect(where.startsWith(worktreesOf(project(root)))).toBe(true);
    expect(existsSync(join(where, 'tracked.txt'))).toBe(true);

    // Its own branch, which is what stops two sessions committing over each
    // other. `--no-track`, so a push inside it does not go at `main`.
    const said = execFileSync('git', ['-C', where, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
    expect(said).toMatch(/^agents\//);
  });

  it('brings along the files a checkout leaves behind', async () => {
    const root = repository();
    const { client } = await joined(root);
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/carried',
        provider: 'echo',
        workingDirectories: [`file://${project(root)}`],
        config: { isolation: 'worktree', branch: 'main', worktreeIncludeFiles: '.env' },
      },
    });
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/carried' } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    const where = state.workingDirectories[0]?.replace('file://', '') ?? '';
    // In the worktree and not in the project it came from, which is the whole
    // assertion: the original has a `.env` already.
    expect(where.startsWith(worktreesOf(project(root)))).toBe(true);
    // Without this the isolation works and the session inside it cannot run
    // anything - a failure the person meets after choosing it.
    expect(readFileSync(join(where, '.env'), 'utf8')).toBe('SECRET=1\n');
  });

  it('says on the session why its directory is where it is', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/readable';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [`file://${project(root)}`],
        config: { isolation: 'worktree', branch: 'main' },
      },
    });
    const config = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: {
        state: {
          config: {
            schema: { properties: Record<string, { readOnly?: boolean; sessionMutable?: boolean; enum?: string[] }> };
            values: Record<string, string>;
          };
        };
      };
    }).snapshot.state.config;
    // The host's keys never reach the backend, and the session channel reports
    // the backend's settings - so without this a worktree session said nothing
    // anywhere about why its directory was where it was.
    expect(config.values.isolation).toBe('worktree');
    expect(config.values.branch).toBe('main');
    /*
     * Offered, not merely reported.
     *
     * A client creates the backend session *before* the first message - the
     * controls need somewhere to write their answers - and draws them from
     * this schema. Marking the row `readOnly`, or leaving it without an
     * `enum`, is a control that cannot be opened, which made isolation
     * unsettable in exactly the phase it is meant to be settable in.
     * `sessionMutable: false` is what closes it afterwards.
     */
    expect(config.schema.properties.isolation?.readOnly).toBeUndefined();
    expect(config.schema.properties.isolation?.enum).toEqual(['folder', 'worktree']);
    expect(config.schema.properties.isolation?.sessionMutable).toBe(false);
    // And the backend's own keys are still there beside them.
    expect(Object.keys(config.schema.properties).length).toBeGreaterThan(2);
  });

  it('moves a session nobody has spoken in yet into the tree it now asks for', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/pending';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [`file://${project(root)}`],
        config: { isolation: 'folder' },
      },
    });
    /*
     * The phase this exists for.
     *
     * A client creates the backend session before the first message is sent,
     * because its controls need somewhere to write the answers they collect.
     * Isolation is one of those answers, and a host that fixed it the moment
     * the session existed fixed it before anybody had been asked.
     */
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { isolation: 'worktree', branch: 'main' } } },
    });
    // On the directory rather than the value: the answer is recorded as it
    // arrives and the tree is made after it, so a test that waited on the
    // value would be reading the config before the move it asked for.
    const state = await until(
      client,
      uri,
      (held) => (held.workingDirectories?.[0] ?? '') !== `file://${project(root)}`,
    );
    expect(state.config.values.isolation).toBe('worktree');
    // In a tree of its own, beside the repository, and not in the repository.
    const where = state.workingDirectories?.[0] ?? '';
    expect(where.startsWith(`file://${worktreesOf(project(root))}`)).toBe(true);
    expect(where).not.toBe(`file://${project(root)}`);
  });

  it('refuses to move one that has already been spoken in', async () => {
    const root = repository();
    const { client, peer: p } = await joined(root);
    const uri = 'ahp-session:/spoken';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [`file://${project(root)}`],
        config: { isolation: 'folder' },
      },
    });
    const opened = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state;
    client.handle({
      method: 'dispatchAction',
      params: { channel: opened.defaultChat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
    });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { isolation: 'worktree' } } },
    });
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    // Said, rather than accepted and dropped: an agent whose files moved out
    // from under a conversation is the thing this refusal is protecting.
    const refused = p.notes
      .map((note) => (note.params as { rejectionReason?: string }).rejectionReason)
      .filter((reason): reason is string => typeof reason === 'string');
    expect(refused.some((reason) => reason.includes('once the session has started'))).toBe(true);
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories?: string[] } };
    }).snapshot.state;
    expect(state.workingDirectories?.[0]).toBe(`file://${project(root)}`);
  });

  it('puts a client\'s own prefix in front of the branch it makes', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/prefixed';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [`file://${project(root)}`],
        config: { isolation: 'worktree', branch: 'main', worktreeBranchPrefix: 'softov/' },
      },
    });
    const where = ((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state.workingDirectories[0] ?? '').replace('file://', '');
    // `agents/` is the built-in prefix and the client's goes in front of it,
    // so the branch sorts where the person's other tools expect it to.
    const on = execFileSync('git', ['-C', where, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
    expect(on).toBe(`softov/agents/${'prefixed'.slice(0, 8)}`);
  });

  it('continues the chosen branch when asked not to make one', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/continued';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [`file://${project(root)}`],
        config: { isolation: 'worktree', branch: 'release', worktreeCreateNewBranch: 'false' },
      },
    });
    const where = ((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state.workingDirectories[0] ?? '').replace('file://', '');
    // Isolated in a directory of its own, and on the branch that was picked
    // rather than one made for it.
    expect(where.startsWith(worktreesOf(project(root)))).toBe(true);
    const on = execFileSync('git', ['-C', where, 'rev-parse', '--abbrev-ref', 'HEAD']).toString().trim();
    expect(on).toBe('release');
  });

  it('leaves the folder alone when nobody asked for a worktree', async () => {
    const root = repository();
    const { client } = await joined(root);
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/plain',
        provider: 'echo',
        workingDirectories: [`file://${project(root)}`],
        config: { isolation: 'folder' },
      },
    });
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/plain' } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    expect(state.workingDirectories[0]).toBe(`file://${project(root)}`);
    expect(existsSync(worktreesOf(project(root)))).toBe(false);
  });

  it('takes a clean worktree away with the session', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/tidy';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [`file://${project(root)}`],
        config: { isolation: 'worktree', branch: 'main' },
      },
    });
    const where = ((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state.workingDirectories[0] ?? '').replace('file://', '');
    expect(existsSync(where)).toBe(true);

    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    for (let i = 0; i < 40 && existsSync(where); i++) await new Promise((r) => { setTimeout(r, 25); });
    expect(existsSync(where)).toBe(false);
  });

  it('keeps one with work in it, rather than deciding what the work was worth', async () => {
    const root = repository();
    const { client } = await joined(root);
    const uri = 'ahp-session:/busy';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'echo',
        workingDirectories: [`file://${project(root)}`],
        config: { isolation: 'worktree', branch: 'main' },
      },
    });
    const where = ((await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state.workingDirectories[0] ?? '').replace('file://', '');
    expect(where.startsWith(worktreesOf(project(root)))).toBe(true);
    // An afternoon's work nobody committed, which is the one thing here a
    // daemon cannot judge the value of.
    writeFileSync(join(where, 'unsaved.txt'), 'the whole point\n');

    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    await new Promise((r) => { setTimeout(r, 300); });
    expect(existsSync(join(where, 'unsaved.txt'))).toBe(true);
    // Still a worktree of the repository, so `git worktree list` finds it.
    const listed = execFileSync('git', ['-C', project(root), 'worktree', 'list']).toString();
    expect(listed).toContain(where);
  });

  it('refuses isolation it cannot serve the result of', async () => {
    const root = repository();
    // Served at the project itself, so its worktrees would sit outside every
    // root - a session whose own files no client could read back.
    const held = createHost({
      path: project(root),
      agents: [echo({ path: project(root), pace: 0 })],
      worktrees: gitWorktrees(),
    });
    const client = held.accept(peer());
    await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    await expect(client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/outside', provider: 'echo',
        workingDirectories: [`file://${project(root)}`],
        config: { isolation: 'worktree', branch: 'main' },
      },
    })).rejects.toMatchObject({ code: -32602 });
  });
});
