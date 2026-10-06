import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { echo } from '../../../examples/echo/agent.js';
import { uriOf } from '../src/resources.js';
import type { ComputerPort, MachineSource } from '../src/types/computers.js';
import type { GitDir, Worktrees } from '../src/types/worktrees.js';
import {
  resetSdk, claude, complete, createHost, emit, hello, list, machine, open,
  peer, read, resolve, serving, sessionQueries, settle, running,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

/**
 * This checkout, as an absolute path.
 *
 * The tests below read real files out of this repository, so the path has to
 * be found rather than written down: a literal one passes on the machine it
 * was written on and fails on every other, CI included.
 */
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');

beforeEach(resetSdk);

describe('where the agent works', () => {
  const opened = async (also: string[] = []) => {
    const host = serving('/home/softov', also);
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    return client;
  };

  it('runs a session in the directory the client named', async () => {
    const client = await opened(['/brb_main/src']);
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/a',
        provider: 'claude',
        workingDirectories: ['file:///brb_main/src'],
      },
    });
    await settle();
    // `file://` comes off on the way in: a backend handed a URI would open a
    // directory called `file:`.
    expect(sessionQueries().at(-1)?.options.cwd).toBe('/brb_main/src');
  });

  it('reports where it actually is, not where the host was started', async () => {
    const client = await opened(['/brb_main/src']);
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/a',
        provider: 'claude',
        workingDirectories: ['file:///brb_main/src'],
      },
    });
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { workingDirectories: string[] }[];
    };
    expect(listed.items[0]?.workingDirectories).toEqual(['file:///brb_main/src']);
  });

  it('runs one anywhere the client names, the way the reference host does', async () => {
    const client = await opened();
    // `--path` is where the catalogue looks and where a session goes when
    // nobody says; it is not a fence. The window's folder dialog picks any
    // directory on the machine, and the connection token already decided
    // who may ask.
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/a',
        provider: 'claude',
        workingDirectories: ['file:///etc'],
      },
    });
    await settle();
    expect(sessionQueries().at(-1)?.options.cwd).toBe('/etc');
  });

  it('refuses a relative one, in the backend\'s own words', async () => {
    const client = await opened();
    // A relative path is relative to nothing a client can see.
    await expect(client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/a',
        provider: 'claude',
        workingDirectories: ['file://src'],
      },
    })).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('absolute') });
    expect(sessionQueries()).toHaveLength(0);
  });

  it('uses the first one when the client names none', async () => {
    const client = await opened(['/brb_main/src']);
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/a', provider: 'claude' },
    });
    await settle();
    expect(sessionQueries().at(-1)?.options.cwd).toBe('/home/softov');
  });
});

describe('the host\'s filesystem, as far as a client may see it', () => {
  const at = (base: string) => createHost({
    path: base,
    agents: [claude({ paths: [base] })],
    ...machine(),
  }).accept(peer());

  const opened = async (base = REPO) => {
    const client = at(base);
    await client.handle(hello(['0.9.0']));
    return client;
  };

  it('lists a directory, folders first', async () => {
    const client = await opened();
    const found = await client.handle({
      method: 'resourceList',
      params: { channel: 'ahp-root://', uri: `file://${REPO}/packages/sdk/src` },
    }) as { entries: { name: string; type: string }[] };
    expect(found.entries.map((e) => e.name)).toContain('host.ts');
    // A listing in whatever order the filesystem happened to return is one
    // nobody can scan.
    const kinds = found.entries.map((e) => e.type);
    expect(kinds.indexOf('file')).toBeGreaterThan(kinds.lastIndexOf('directory'));
  });

  it('reads a file as text, and says which encoding that was', async () => {
    const client = await opened();
    const found = await client.handle({
      method: 'resourceRead',
      params: { channel: 'ahp-root://', uri: `file://${REPO}/packages/server/package.json` },
    }) as { data: string; encoding: string };
    expect(found.encoding).toBe('utf-8');
    expect(found.data).toContain('"name": "@ahpd/server"');
  });

  it('reads a text file with no extension as text', async () => {
    const client = await opened();
    // Text is judged by the bytes: a name like `LICENSE` or `Makefile` says
    // nothing a list of extensions could know.
    const found = await client.handle({
      method: 'resourceRead',
      params: { channel: 'ahp-root://', uri: `file://${REPO}/LICENSE` },
    }) as { data: string; encoding: string };
    expect(found.encoding).toBe('utf-8');
    expect(found.data.length).toBeGreaterThan(0);
  });

  it('reads bytes that are not text as base64, whatever the name', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-bytes-'));
    try {
      const file = join(root, 'looks.txt');
      writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff]));
      const client = await opened();
      const found = await client.handle({
        method: 'resourceRead',
        params: { channel: 'ahp-root://', uri: `file://${file}` },
      }) as { data: string; encoding: string };
      expect(found.encoding).toBe('base64');
      expect(Buffer.from(found.data, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('serves the whole machine, not only the directories it was started on', async () => {
    const client = await opened(`${REPO}/packages/sdk/src`);
    // The window's folder dialog lists `..` from wherever it is and stats
    // whatever is typed; a host that refused everything outside `--path`
    // was one where no folder outside it could be picked at all. The token
    // on the connection is the boundary, as on the reference host.
    const found = await client.handle({
      method: 'resourceList',
      params: { channel: 'ahp-root://', uri: `file://${REPO}/packages/sdk/src/../../../../..` },
    }) as { entries: { name: string }[] };
    expect(found.entries.length).toBeGreaterThan(0);
    await expect(client.handle({
      method: 'resourceResolve',
      params: { channel: 'ahp-root://', uri: 'file:///' },
    })).resolves.toMatchObject({ type: 'directory' });
  });

  it('refuses a relative path, which is relative to nothing a client can see', async () => {
    const client = await opened();
    await expect(client.handle({
      method: 'resourceRead',
      params: { channel: 'ahp-root://', uri: 'file://packages/sdk/src/host.ts' },
    })).rejects.toMatchObject({ code: -32602 });
  });

  it('says a missing file is missing, not forbidden', async () => {
    const client = await opened();
    // The two are different answers and a client acts differently on each.
    await expect(client.handle({
      method: 'resourceRead',
      params: { channel: 'ahp-root://', uri: `file://${REPO}/nothing-here.txt` },
    })).rejects.toMatchObject({ code: -32008 });
  });

  it('resolves what a path is without opening it', async () => {
    const client = await opened();
    const found = await client.handle({
      method: 'resourceResolve',
      params: { channel: 'ahp-root://', uri: `file://${REPO}/packages/sdk/src` },
    }) as { type: string; uri: string };
    expect(found.type).toBe('directory');
    expect(found.uri).toBe(`file://${REPO}/packages/sdk/src`);
  });

  it('serves a write to a connected client without a grant', async () => {
    const where = mkdtempSync(join(tmpdir(), 'ahpd-grant-'));
    try {
      const client = await opened(where);
      // No `resourceRequest` first. The reference host enforces no per-resource
      // grant for client to server access, its client never asks for one, and a
      // window that could not save was the whole symptom.
      await expect(client.handle({
        method: 'resourceWrite',
        params: { channel: 'ahp-root://', uri: `file://${where}/written.txt`, data: 'x', encoding: 'utf-8' },
      })).resolves.toEqual({});
      expect(readFileSync(join(where, 'written.txt'), 'utf8')).toBe('x');
    } finally {
      rmSync(where, { recursive: true, force: true });
    }
  });

  it('answers -32601 for a store that only reads, which is not a refusal about a path', async () => {
    // Two different ways not to have this, and they must not be confused: a
    // host with a read-only store does not serve the method at all, while a
    // path the store cannot write is that store's own refusal. Neither is a
    // grant, which this host no longer asks for.
    const host = createHost({
      path: REPO,
      agents: [claude({ paths: [REPO] })],
      resources: { list, read, resolve, complete },
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    for (const method of ['resourceWrite', 'resourceDelete', 'resourceMkdir', 'resourceMove', 'resourceCopy']) {
      await expect(client.handle({
        method,
        params: {
          channel: 'ahp-root://',
          uri: `file://${REPO}/x`,
          source: `file://${REPO}/x`,
          destination: `file://${REPO}/y`,
          data: '',
          encoding: 'utf-8',
        },
      }), method).rejects.toMatchObject({ code: -32601 });
    }
  });
});

describe('completing an at-sign', () => {
  it('offers paths under the session\'s own directory', async () => {
    const host = createHost({ path: REPO, agents: [claude({ paths: [REPO] })], ...machine() });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    const found = await client.handle({
      method: 'completions',
      params: { channel: 'ahp-chat:/live', kind: 'userMessage', text: 'look at @packages/sdk/src/ho', offset: 30 },
    }) as { items: { insertText: string; rangeStart: number; attachment: { type: string; uri: string } }[] };

    expect(found.items.map((i) => i.insertText)).toContain('@packages/sdk/src/host.ts');
    // The whole `@…` is replaced, so completing does not leave two at-signs.
    expect(found.items[0]?.rangeStart).toBe(8);
    // A reference rather than the bytes: a completion that carried the file
    // would carry it per keystroke.
    const file = found.items.find((i) => i.insertText === '@packages/sdk/src/host.ts');
    expect(file?.attachment).toMatchObject({ type: 'resource', uri: `file://${REPO}/packages/sdk/src/host.ts` });
  });

  it('answers an encoded attachment URI, so a reader can get the path back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd files '));
    try {
      writeFileSync(join(dir, 'notes.txt'), 'x');
      const host = createHost({ path: dir, agents: [claude({ paths: [dir] })], ...machine() });
      const client = host.accept(peer());
      await client.handle(hello(['0.9.0']));
      const found = await client.handle({
        method: 'completions',
        params: { channel: 'ahp-root://', kind: 'userMessage', text: 'look at @not', offset: 12 },
      }) as { items: { insertText: string; attachment: { uri: string } }[] };

      const file = found.items.find((i) => i.insertText === '@notes.txt');
      // A folder with a space in its name completes to a URI that has to name
      // it back: unencoded, the attachment reads as a file called `ahpd%20files`.
      expect(file?.attachment.uri).toBe(uriOf(join(dir, 'notes.txt')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps a directory\'s slash, so the next keystroke goes into it', async () => {
    const host = createHost({ path: REPO, agents: [claude({ paths: [REPO] })], ...machine() });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const found = await client.handle({
      method: 'completions',
      params: { channel: 'ahp-root://', kind: 'userMessage', text: '@pack', offset: 5 },
    }) as { items: { insertText: string }[] };
    expect(found.items.map((i) => i.insertText)).toContain('@packages/');
  });

  it('leaves a slash command alone, because the two cannot both match', async () => {
    const host = createHost({ path: REPO, agents: [claude({ paths: [REPO] })], ...machine() });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const found = await client.handle({
      method: 'completions',
      params: { channel: 'ahp-root://', kind: 'userMessage', text: 'mail me@example.com', offset: 19 },
    }) as { items: unknown[] };
    // An at-sign mid-word is an address, not a path.
    expect(found.items).toEqual([]);
  });
});

describe('more than one directory', () => {
  it('advertises that it can, and which slot is fixed', async () => {
    const client = open();
    const result = await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] })) as {
      snapshots: { state: { agents: { capabilities?: { multipleWorkingDirectories?: unknown } }[] } }[];
    };
    /*
     * Both, deliberately.
     *
     * `immutablePrimary` because the backend's process is rooted at index 0
     * and cannot move while it runs; `primaryReplacement` because this host
     * can start it again somewhere else, and the protocol says a backend MAY
     * advertise both so an older client keeps the safe reading.
     */
    expect(result.snapshots[0]?.state.agents[0]?.capabilities?.multipleWorkingDirectories)
      .toEqual({ immutablePrimary: true, primaryReplacement: true });
  });

  it('hands every directory the client named to the harness', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/wide', provider: 'claude',
        workingDirectories: ['file:///home/softov/one', 'file:///home/softov/two'],
      },
    });
    // The first is the process root; the rest are its peers, which the SDK
    // takes at startup as `additionalDirectories`.
    expect(sessionQueries().at(-1)?.options.cwd).toBe('/home/softov/one');
    expect(sessionQueries().at(-1)?.options.additionalDirectories).toEqual(['/home/softov/two']);
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/wide' } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    expect(state.workingDirectories).toEqual(['file:///home/softov/one', 'file:///home/softov/two']);
  });

  it('starts the agent again, resumed, when a directory is added to a running session', async () => {
    const { client, uri } = await running();
    // The CLI names the conversation, and that name is what a resume asks for.
    await emit({ type: 'system', subtype: 'init', session_id: 'sdk-wide' });
    const before = sessionQueries().length;
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'session/workingDirectorySet', directory: 'file:///home/softov/extra' },
      },
    });
    await settle();
    /*
     * A new CLI, on the same conversation.
     *
     * The SDK takes its directories when the process starts and offers no way
     * to add one after, so the honest implementation is to start it again and
     * *resume* - which is what makes this the same conversation in a wider
     * place rather than a new one.
     */
    expect(sessionQueries().length).toBe(before + 1);
    expect(sessionQueries().at(-1)?.options.additionalDirectories).toEqual(['/home/softov/extra']);
    expect(sessionQueries().at(-1)?.options.resume).toBeDefined();
  });

  it('refuses to remove the directory the agent runs in', async () => {
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/rooted';
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'claude', workingDirectories: ['file:///home/softov/one'] },
    });
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'session/workingDirectoryRemoved', directory: 'file:///home/softov/one' },
      },
    });
    await settle();
    // The protocol says a client MUST NOT remove index 0. Said out loud rather
    // than ignored, so a client that tried learns why nothing happened.
    const refused = p.notes
      .map((one) => (one.params as { rejectionReason?: string }).rejectionReason)
      .filter((one): one is string => typeof one === 'string');
    expect(refused.some((one) => one.includes('cannot be removed'))).toBe(true);
  });

  /*
   * The chat half of the same feature.
   *
   * A chat may hold fewer directories than its session, never more: the
   * session's set is what the person opened, and a chat that could widen it
   * would be a chat granting itself access to a folder nobody chose.
   */
  const wide = async () => {
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0']));
    const uri = 'ahp-session:/split';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'claude',
        workingDirectories: ['file:///home/softov/one', 'file:///home/softov/two', 'file:///home/softov/three'],
      },
    });
    return { client, peer: p, uri };
  };

  it('opens a chat in the subset it was asked for, and says so on the chat', async () => {
    const { client, uri } = await wide();
    const chat = 'ahp-chat:/narrow';
    await client.handle({
      method: 'createChat',
      params: { channel: uri, chat, workingDirectories: ['file:///home/softov/one', 'file:///home/softov/three'] },
    });
    // The first entry is the session's process root and is not a choice; what
    // a chat picks among is the peers, and the CLI takes those at startup.
    expect(sessionQueries().at(-1)?.options.cwd).toBe('/home/softov/one');
    expect(sessionQueries().at(-1)?.options.additionalDirectories).toEqual(['/home/softov/three']);
    const state = (await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    expect(state.workingDirectories).toEqual(['file:///home/softov/one', 'file:///home/softov/three']);
  });

  it('refuses to open a chat somewhere the session is not', async () => {
    const { client, uri } = await wide();
    await expect(client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/stray', workingDirectories: ['file:///home/softov/elsewhere'] },
    })).rejects.toThrow(/is not a working directory of/);
  });

  it('starts one chat again when its own set changes, and leaves the others alone', async () => {
    const { client, peer: p, uri } = await wide();
    const chat = 'ahp-chat:/narrow';
    await client.handle({
      method: 'createChat',
      params: { channel: uri, chat, workingDirectories: ['file:///home/softov/one', 'file:///home/softov/three'] },
    });
    const before = sessionQueries().length;
    client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/workingDirectorySet', directory: 'file:///home/softov/two' } },
    });
    await settle();
    // One CLI, not the session's every chat: the session's own set has not
    // moved, so the default chat is still running where it was.
    expect(sessionQueries().length).toBe(before + 1);
    expect(sessionQueries().at(-1)?.options.additionalDirectories)
      .toEqual(['/home/softov/three', '/home/softov/two']);

    client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/workingDirectoryRemoved', directory: 'file:///home/softov/three' } },
    });
    await settle();
    expect(sessionQueries().at(-1)?.options.additionalDirectories).toEqual(['/home/softov/two']);

    // And the same rule as `createChat`, said rather than silently widening.
    client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/workingDirectorySet', directory: 'file:///home/softov/elsewhere' } },
    });
    await settle();
    const refused = p.notes
      .map((one) => (one.params as { rejectionReason?: string }).rejectionReason)
      .filter((one): one is string => typeof one === 'string');
    expect(refused.some((one) => one.includes('is not a working directory of'))).toBe(true);
  });
});

describe('the repository a session\'s machine is handed', () => {
  let dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  /** A host whose git port answers `answer` for every folder, and whose machine maker remembers what it was asked. */
  const hosted = async (answer: (dir: string) => Promise<GitDir | undefined>) => {
    const asked: MachineSource[] = [];
    const questions: string[] = [];
    const lines: string[] = [];
    const root = mkdtempSync(join(tmpdir(), 'ahpd-gitdir-'));
    dirs.push(root);
    const worktrees: Worktrees = {
      repository: async () => undefined,
      branches: async () => [],
      create: async () => {},
      dirty: async () => false,
      remove: async () => {},
      gitDir: async (dir) => { questions.push(dir); return answer(dir); },
    };
    const computers: ComputerPort = {
      how: async () => undefined,
      create: async (source) => { asked.push(source); return 'box'; },
    };
    const host = createHost({
      path: root,
      agents: [echo({ path: root, pace: 0 })],
      worktrees,
      computers,
      onEvent: (line) => { lines.push(line); },
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const start = async (folder: string, computer = 'disposable:box') => {
      await client.handle({
        method: 'createSession',
        params: { channel: 'ahp-session:/git', provider: 'echo', workingDirectories: [`file://${folder}`], config: { computer } },
      });
      await settle();
    };
    return { root, asked, questions, lines, start };
  };

  it('hands a worktree session the git directory it belongs to', async () => {
    const { root, asked, start } = await hosted(async (dir) => ({ gitDir: '/repo/.git', repository: dir }));
    await start(root);
    expect(asked[0]).toMatchObject({ folder: root, gitDir: '/repo/.git' });
    expect(asked[0]?.repository).toBeUndefined();
  });

  it('hands a session at the repository root its git directory, and no root', async () => {
    const { root, asked, start } = await hosted(async (dir) => ({ gitDir: join(dir, '.git'), repository: dir }));
    await start(root);
    // Inside the folder, so it adds no mount; the machine still guards it.
    expect(asked[0]).toMatchObject({ folder: root, gitDir: join(root, '.git') });
    expect(asked[0]?.repository).toBeUndefined();
  });

  it('hands a session in a subfolder the repository root to mount', async () => {
    const { root, asked, start } = await hosted(async (dir) => ({ gitDir: join(dir, '..', '.git'), repository: join(dir, '..') }));
    const below = join(root, 'src');
    mkdirSync(below);
    await start(below);
    expect(asked[0]).toMatchObject({ folder: below, gitDir: join(root, '.git'), repository: root });
  });

  it('hands neither when git refuses the folder, and says why in one line', async () => {
    const { root, asked, lines, start } = await hosted(async () => { throw new Error('fatal: bad config line 1'); });
    await start(root);
    expect(asked[0]?.folder).toBe(root);
    expect(asked[0]?.gitDir).toBeUndefined();
    expect(asked[0]?.repository).toBeUndefined();
    const said = lines.filter((line) => line.includes('fatal: bad config line 1'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(root);
  });

  it('asks about a dev container\'s own folder', async () => {
    const { root, asked, questions, start } = await hosted(async (dir) => ({ gitDir: '/repo/.git', repository: dir }));
    const other = join(root, 'other');
    mkdirSync(other);
    await start(root, `devcontainer://${other}`);
    expect(questions).toEqual([other]);
    expect(asked[0]).toMatchObject({ source: `devcontainer://${other}`, gitDir: '/repo/.git' });
  });
});
