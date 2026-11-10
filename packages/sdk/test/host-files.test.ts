import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, resolve as resolvePath } from 'node:path';
import { echo } from '../../../examples/echo/agent.js';
import { uriOf } from '../src/resources/resources.js';
import type { Start } from '../src/types/agent.js';
import type { ComputerPort, MachineSource } from '../src/types/computers.js';
import type { GitDir, Worktrees } from '../src/types/worktrees.js';
import type { HostOptions, WorkspaceFiles } from '../src/types/host.js';
import {
  startedBySend,
  resetSdk, actions, builtServer, claude, complete, createHost, emit, firstMessage, hello, hostTools, list, machine, open,
  peer, read, resolve, sendAnswered, serving, sessionQueries, settle, running, wrote,
} from './support/host.js';
import { WORK } from './support/work.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

/**
 * This checkout, as an absolute path.
 *
 * The tests below read real files out of this repository, so the path has to
 * be found rather than written down: a literal one passes on the machine it
 * was written on and fails on every other, CI included.
 */
// The trailing separator off, `\\` on Windows and `/` elsewhere.
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/[\\/]$/u, '');

beforeEach(resetSdk);

describe('where the agent works', () => {
  const opened = async (also: string[] = [], over: Partial<HostOptions> = {}) => {
    const host = serving(WORK, also, over);
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    return client;
  };

  /** A home of the case's own, so a scratch folder is made where nothing else lives. */
  const homed = (): string => {
    const home = mkdtempSync(join(tmpdir(), 'ahpd-home-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    onTestFinished(async () => {
      vi.unstubAllEnvs();
      await rm(home, { recursive: true, force: true });
    });
    return home;
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
    await sendAnswered(client, 'ahp-session:/a');
    // `file://` comes off on the way in: a backend handed a URI would open a
    // directory called `file:`.
    expect(sessionQueries().at(-1)?.options.cwd).toBe('/brb_main/src');
  });

  it('reports where it actually is, not where the host was started', async () => {
    // A summary names only a folder that is there, so this one has to exist on
    // whichever machine runs the test.
    const client = await opened([REPO]);
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/a',
        provider: 'claude',
        workingDirectories: [uriOf(REPO)],
      },
    });
    // Listed from its first message, on the chat the host minted for it.
    await firstMessage(client, ((await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/a' } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat);
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { workingDirectories: string[] }[];
    };
    expect(listed.items[0]?.workingDirectories).toEqual([uriOf(REPO)]);
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
    await sendAnswered(client, 'ahp-session:/a');
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
    await sendAnswered(client, 'ahp-session:/a');
    expect(sessionQueries().at(-1)?.options.cwd).toBe(WORK);
  });

  /*
   * VS Code's host works a session that names no folder in a scratch folder
   * of its own under `~/.copilot/chats`, made when the session is, made again
   * when it is gone, and removed with the session; `scratch` is that.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/workspacelessScratchDir.ts#L14-L20
   */
  it('works one that names none in a scratch folder of its own, removed with it, when the daemon says scratch', async () => {
    const home = homed();
    const client = await opened([], { workspacelessFolder: 'scratch' });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/a', provider: 'claude' } });
    await settle();
    const folder = join(home, '.copilot', 'chats', 'a');
    expect(sessionQueries().at(-1)?.options.cwd).toBe(folder);
    expect(existsSync(folder)).toBe(true);

    await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/a' } });
    expect(existsSync(folder)).toBe(false);
  });

  /*
   * A session working in its scratch folder is VS Code's workspace-less
   * session: marked on its `_meta`, its agent told last that it works in a
   * scratch folder, and `set_workspace` offered to it up front; a session in
   * the first served folder is none of it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10698-L10700
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/prompts/promptRegistry.ts#L220-L229
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/sessionServerTools.ts#L2255-L2258
   */
  it('makes a session in its scratch folder VS Code\'s workspace-less session, and one in the first served folder none of it', async () => {
    homed();
    const told = async (over: Partial<HostOptions>) => {
      const client = await opened([], { tools: hostTools(), ...over });
      const uri = `ahp-session:/${over.workspacelessFolder ?? 'first'}`;
      await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
      await settle();
      const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { _meta?: Record<string, unknown> } };
      }).snapshot.state;
      const query = sessionQueries().at(-1);
      const servers = query?.options.mcpServers as Record<string, { tools: { name: string; _meta?: Record<string, unknown> }[] }>;
      // What the CLI is told beside a prompt, through its `UserPromptSubmit` hook.
      type Hook = (input: unknown, id: undefined, options: { signal: AbortSignal }) => Promise<{ hookSpecificOutput?: { additionalContext?: string } }>;
      const hooks = (query?.options.hooks as Record<string, { hooks: Hook[] }[]> | undefined)?.UserPromptSubmit ?? [];
      const answers = await Promise.all(hooks.flatMap((one) => one.hooks)
        .map((hook) => hook({ hook_event_name: 'UserPromptSubmit', prompt: '' }, undefined, { signal: new AbortController().signal })));
      return {
        mark: state._meta?.workspaceless,
        prompt: answers.map((one) => one.hookSpecificOutput?.additionalContext ?? '').join('\n'),
        upFront: servers.host?.tools.find((one) => one.name === 'set_workspace')?._meta?.['anthropic/alwaysLoad'],
      };
    };
    const scratch = await told({ workspacelessFolder: 'scratch' });
    expect(scratch.mark).toBe(true);
    expect(scratch.prompt).toContain('This lightweight chat has a SCRATCH working directory, not a project or repository.');
    expect(scratch.upFront).toBe(true);

    const first = await told({});
    expect(first.mark).toBeUndefined();
    expect(first.prompt).not.toContain('<workspaceless_chat>');
    expect(first.upFront).toBe(false);
  });

  it('makes a session\'s scratch folder again when a start finds it gone', async () => {
    const home = homed();
    const client = await opened([], { workspacelessFolder: 'scratch' });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/a', provider: 'claude' } });
    await settle();
    const folder = join(home, '.copilot', 'chats', 'a');
    await rm(folder, { recursive: true });

    await client.handle({ method: 'createChat', params: { channel: 'ahp-session:/a', chat: 'ahp-chat:/side' } });
    await settle();
    expect(existsSync(folder)).toBe(true);
  });

  it('refuses a session whose id names no folder of its own under the chats folder', async () => {
    const home = homed();
    const client = await opened([], { workspacelessFolder: 'scratch' });
    await expect(client.handle({ method: 'createSession', params: { channel: 'ahp-session:/..', provider: 'claude' } }))
      .rejects.toMatchObject({ code: -32602, message: expect.stringContaining('names no folder of its own') });
    // Nor one that spells the chats folder itself, as VS Code requires a
    // strict descendant of the root it keeps a folder in.
    // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/worktreePaths.ts#L35-L42
    await expect(client.handle({ method: 'createSession', params: { channel: 'ahp-session:/a/..', provider: 'claude' } }))
      .rejects.toMatchObject({ code: -32602, message: expect.stringContaining('names no folder of its own') });
    expect(sessionQueries()).toHaveLength(0);
    expect(existsSync(join(home, '.copilot', 'chats'))).toBe(false);
  });

  it('takes a push of workspacelessFolder for the next session', async () => {
    const home = homed();
    // A daemon that holds the one key, so what it holds is what the push left.
    const held: Record<string, unknown> = {};
    const rootConfig: NonNullable<HostOptions['rootConfig']> = {
      schema: () => ({
        type: 'object',
        properties: { workspacelessFolder: { type: 'string', enum: ['first', 'scratch'], title: 'Workspaceless folder' } },
      }),
      values: async () => ({ ...held }),
      write: async (values) => { Object.assign(held, values); return {}; },
    };
    const client = await opened([], { rootConfig });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { workspacelessFolder: 'scratch' } } },
    });
    await settle();
    expect(held.workspacelessFolder).toBe('scratch');
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/a', provider: 'claude' } });
    await settle();
    expect(sessionQueries().at(-1)?.options.cwd).toBe(join(home, '.copilot', 'chats', 'a'));
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
      params: { channel: 'ahp-root://', uri: uriOf(join(REPO, 'packages', 'sdk', 'src')) },
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
      params: { channel: 'ahp-root://', uri: uriOf(join(REPO, 'packages', 'server', 'package.json')) },
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
      params: { channel: 'ahp-root://', uri: uriOf(join(REPO, 'LICENSE')) },
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
        params: { channel: 'ahp-root://', uri: uriOf(file) },
      }) as { data: string; encoding: string };
      expect(found.encoding).toBe('base64');
      expect(Buffer.from(found.data, 'base64')).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff]));
    } finally {
      await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
      params: { channel: 'ahp-root://', uri: uriOf(join(REPO, 'packages', 'sdk', 'src', '..', '..', '..', '..', '..')) },
    }) as { entries: { name: string }[] };
    expect(found.entries.length).toBeGreaterThan(0);
    await expect(client.handle({
      method: 'resourceResolve',
      params: { channel: 'ahp-root://', uri: uriOf(parse(REPO).root) },
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
      params: { channel: 'ahp-root://', uri: uriOf(join(REPO, 'packages', 'sdk', 'src')) },
    }) as { type: string; uri: string };
    expect(found.type).toBe('directory');
    expect(found.uri).toBe(uriOf(join(REPO, 'packages', 'sdk', 'src')));
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
        params: { channel: 'ahp-root://', uri: uriOf(join(where, 'written.txt')), data: 'x', encoding: 'utf-8' },
      })).resolves.toEqual({});
      expect(readFileSync(join(where, 'written.txt'), 'utf8')).toBe('x');
    } finally {
      await rm(where, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  /*
   * An operation a store that only reads leaves out is NotFound in VS Code's
   * words, as its host answers an operation a provider does not implement.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostResourceProviders.ts#L88-L95
   */
  it('answers NotFound in VS Code\'s words for each operation a store that only reads leaves out', async () => {
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
          uri: uriOf(join(REPO, 'x')),
          source: uriOf(join(REPO, 'x')),
          destination: uriOf(join(REPO, 'y')),
          data: '',
          encoding: 'utf-8',
        },
      }), method).rejects.toMatchObject({ code: -32008, message: expect.stringMatching(/^Resource operation '\w+' is not supported for: /) });
    }
  });
});

/** A listing of each directory's files, as ripgrep lists them, for a host to complete against. */
const listing = (byDir: Record<string, string[]>): WorkspaceFiles => {
  // Keyed by the folder as the host resolves it, so a spelling of it lists the same files.
  const held = new Map(Object.entries(byDir).map(([dir, files]) => [resolvePath(dir), files]));
  return { getFiles: async (dir) => ({ files: (held.get(resolvePath(dir)) ?? []).map((one) => join(dir, one)), isTruncated: false }) };
};

type FileItem = { insertText: string; rangeStart: number; rangeEnd: number; attachment: Record<string, unknown> };

/** A session working in `dir` on a host listing `files` there, and what one completion of `text` answers. */
const filesFor = async (dir: string, files: string[], text: string, trigger = '@'): Promise<FileItem[]> => {
  const host = createHost({ path: dir, agents: [claude({ paths: [dir] })], ...machine(), workspaceFiles: listing({ [dir]: files }) });
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0']));
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude', workingDirectories: [uriOf(dir)] } });
  const typed = text.replace('@', trigger);
  return (await client.handle({
    method: 'completions',
    params: { channel: 'ahp-session:/live', kind: 'userMessage', text: typed, offset: typed.length },
  }) as { items: FileItem[] }).items;
};

/*
 * VS Code's file completion provider: the files under the session's working
 * directories ranked by the Quick Open scorer, the trigger inserted with the
 * file's name, and a name two files share labelled with the folder each is in.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostFileCompletionProvider.ts#L119-L218
 */
describe('completing an at-sign', () => {
  it('offers the files under the session\'s working directory as VS Code\'s Quick Open ranks them, inserting the name', async () => {
    const found = await filesFor(REPO, ['README.md', 'packages/sdk/src/hosting.md', 'packages/sdk/src/host.ts'], 'look at @host');
    // A prefix of the name ranks first, the shorter name above the longer, and
    // a file the word does not match is not offered.
    expect(found.map((i) => i.insertText)).toEqual(['@host.ts', '@hosting.md']);
    // The whole `@…` is replaced, so completing does not leave two at-signs;
    // a reference rather than the bytes, since a completion that carried the
    // file would carry it per keystroke.
    expect(found[0]).toEqual({
      insertText: '@host.ts',
      rangeStart: 8,
      rangeEnd: 13,
      attachment: { type: 'resource', uri: uriOf(join(REPO, 'packages', 'sdk', 'src', 'host.ts')), label: 'host.ts', displayKind: 'document' },
    });
  });

  it('labels a name two files share with the folder each is in', async () => {
    const found = await filesFor(REPO, ['a/index.ts', 'b/index.ts'], '@index');
    const owner = parse(REPO).base;
    expect(found.map((i) => i.attachment.label)).toEqual([`${owner} • a/index.ts`, `${owner} • b/index.ts`]);
  });

  it('offers the files in the order they were listed while nothing is typed, fifty at most', async () => {
    const many = Array.from({ length: 60 }, (_, at) => `f${String(at).padStart(2, '0')}.txt`);
    const found = await filesFor(REPO, many, '@');
    expect(found.map((i) => i.insertText)).toEqual(many.slice(0, 50).map((one) => `@${one}`));
  });

  it('answers an encoded attachment URI, so a reader can get the path back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd files '));
    try {
      const found = await filesFor(dir, ['notes.txt'], 'look at @not');
      // A folder with a space in its name completes to a URI that has to name
      // it back: unencoded, the attachment reads as a file called `ahpd%20files`.
      expect(found.find((i) => i.insertText === '@notes.txt')?.attachment.uri).toBe(uriOf(join(dir, 'notes.txt')));
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('offers no file on a host given no listing', async () => {
    const host = createHost({ path: REPO, agents: [claude({ paths: [REPO] })], ...machine() });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    const found = await client.handle({
      method: 'completions',
      params: { channel: 'ahp-session:/live', kind: 'userMessage', text: '@host', offset: 5 },
    }) as { items: unknown[] };
    expect(found.items).toEqual([]);
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

describe('completing a hash sign', () => {
  /*
   * The same files as the at-sign, under the other trigger.
   *
   * VS Code's window offers `#` for a file exactly as it offers `@`, and its
   * own host reads the two in one provider and answers them with one list. So
   * what is checked here is that this host does the same, and that the only
   * difference between the two answers is the character put back in front of
   * the path - which is what decides whether the client keeps the token.
   */
  it('offers the files an at-sign offers, with the hash kept', async () => {
    const files = ['README.md', 'packages/sdk/src/hosting.md', 'packages/sdk/src/host.ts'];
    const hashes = await filesFor(REPO, files, 'look at @packages/sdk/src/ho', '#');
    const ats = await filesFor(REPO, files, 'look at @packages/sdk/src/ho');

    // The same files, in the same order, with nothing else about them moved.
    expect(hashes.map((i) => i.insertText)).toEqual(ats.map((i) => i.insertText.replace(/^@/, '#')));
    expect(hashes.map((i) => i.attachment)).toEqual(ats.map((i) => i.attachment));
    // The whole `#…` is replaced, so completing does not leave two hashes.
    expect(hashes[0]?.rangeStart).toBe(8);
    expect(hashes[0]?.rangeEnd).toBe('look at #packages/sdk/src/ho'.length);
    expect(hashes.map((i) => i.insertText)).toEqual(['#host.ts', '#hosting.md']);
  });

  /*
   * And `#chat:`, the one hash that is not a file.
   *
   * A chat of the session is what a person points a message at, and its title
   * is what they pick it by - so what is checked here is the list, the filter
   * and the attachment, and that the chat being typed in is not offered to
   * itself.
   */
  type Item = {
    insertText: string;
    rangeStart: number;
    rangeEnd: number;
    attachment: { type: string; resource: string; label: string; endTurn?: string };
  };
  type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

  /** What one completions call answers for a text, on a channel. */
  const completing = async (client: Client, channel: string, text: string): Promise<Item[]> =>
    (await client.handle({
      method: 'completions',
      params: { channel, kind: 'userMessage', text, offset: text.length },
    }) as { items: Item[] }).items;

  /** One turn of a chat, finished, under an id this test names. */
  const spoken = async (client: Client, chat: string, turnId: string, text: string): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
    });
    await settle();
    // The CLI naming its conversation, and then the end of the turn: this is
    // what leaves the chat a completed turn for an attachment to be pinned to.
    await emit({ type: 'system', subtype: 'init', session_id: `sdk-${turnId}` });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
  };

  /**
   * A host whose every start is kept, so a worker can be opened on one.
   *
   * `Start.subagent` is the host's own way of opening a chat a tool started -
   * the backend calls it while a tool call runs - so a case about workers has
   * to hold the start the host handed over.
   */
  const holding = async () => {
    const starts: Start[] = [];
    const backend = claude({ paths: [REPO] });
    const host = createHost({
      path: REPO,
      agents: [{ ...backend, create: (start: Start) => { starts.push(start); return backend.create(start); } }],
      ...machine(),
      workspaceFiles: listing({ [REPO]: ['README.md', 'packages/sdk/src/host.ts'] }),
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    return { client, starts };
  };

  /**
   * A session with three chats, each titled by the message it opened with and
   * each with a finished turn, which is what a chat is offered for.
   *
   * A pause between them, so the order they are offered in is the order they
   * were last spoken to rather than a tie between two timestamps read in the
   * same millisecond.
   */
  const chatty = async () => {
    const { client } = await holding();
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/chats', provider: 'claude' } });
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/chats' } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    await spoken(client, opened.snapshot.state.defaultChat, 't0', 'Look around');
    for (const [chat, turnId, text] of [['ahp-chat:/review', 't1', 'Review the diff'], ['ahp-chat:/plan', 't2', 'Plan the work']] as const) {
      await new Promise((r) => { setTimeout(r, 5); });
      await client.handle({ method: 'createChat', params: { channel: 'ahp-session:/chats', chat } });
      await settle();
      await spoken(client, chat, turnId, text);
    }
    return { client, handed: opened.snapshot.state.defaultChat };
  };

  it('offers the files beside the chats while the hash is still becoming one', async () => {
    const { client } = await chatty();
    /*
     * A bare `#` is also the first keystroke of `#chat:`.
     *
     * VS Code fans one completions request out to every provider and a client
     * shows the merged list, so a word that could still become `#chat:` is
     * answered with the chats and the files both: whoever is about to type
     * `chat:` was choosing a file a keystroke ago, and the list must not empty
     * itself out under them. The chats come first, and the whole word is the
     * range either way.
     */
    const both = await completing(client, 'ahp-session:/chats', 'look at #');
    expect(both[0]?.attachment.type).toBe('chat');
    expect(both.filter((one) => one.attachment.type === 'chat')).toHaveLength(2);
    expect(both.filter((one) => one.attachment.type === 'resource').length).toBeGreaterThan(0);
    expect(both.map((one) => [one.rangeStart, one.rangeEnd])).toEqual(both.map(() => [8, 9]));
    // `#chat` with no colon is still a word on its way there, so it is still
    // both lists.
    const partway = await completing(client, 'ahp-session:/chats', 'look at #chat');
    expect(partway.filter((one) => one.attachment.type === 'chat')).toHaveLength(2);

    // Said whole, it is a chat and nothing else: a path that happened to begin
    // with `chat:` is not what the word means, so no file is offered beside it.
    const arrived = await completing(client, 'ahp-session:/chats', 'look at #chat:');
    expect(arrived).toHaveLength(2);
    expect(arrived.every((one) => one.attachment.type === 'chat')).toBe(true);
  });

  it('offers the session\'s other chats, and not the one being typed in', async () => {
    const { client, handed } = await chatty();
    const found = await completing(client, 'ahp-session:/chats', 'tell #chat:');

    // Newest first, and neither the chat the session hands out nor the one the
    // text is being typed in.
    expect(found.map((one) => one.attachment.resource)).toEqual(['ahp-chat:/plan', 'ahp-chat:/review']);
    // The whole `#chat:` token is replaced, so completing leaves no half of it
    // behind, and the attachment names the chat by the title that was inserted.
    expect(found[1]).toMatchObject({
      insertText: '#chat:Review the diff ',
      rangeStart: 5,
      rangeEnd: 11,
      attachment: { type: 'chat', resource: 'ahp-chat:/review', label: 'Review the diff' },
    });

    // Typed in one of those chats instead, the same list with that one taken
    // out and the session's own chat added: which one is current is wherever
    // the person is standing.
    const other = await completing(client, 'ahp-chat:/review', 'tell #chat:');
    expect(other.map((one) => one.attachment.resource)).toEqual(['ahp-chat:/plan', handed]);
  });

  it('offers only the chats whose title holds what was typed', async () => {
    const { client } = await chatty();
    const found = await completing(client, 'ahp-session:/chats', 'tell #chat:rev');
    expect(found.map((one) => one.attachment.label)).toEqual(['Review the diff']);
    // Case blind, as VS Code's filter is: `rev` finds `Review`.
    const shouted = await completing(client, 'ahp-session:/chats', 'tell #chat:REV');
    expect(shouted.map((one) => one.attachment.label)).toEqual(['Review the diff']);
    // The range covers the filter as well as the prefix, so the word typed is
    // replaced whole.
    expect(found[0]).toMatchObject({ rangeStart: 5, rangeEnd: 14 });
    expect(await completing(client, 'ahp-session:/chats', 'tell #chat:nothing')).toEqual([]);
  });

  it('does not offer a worker chat a tool started', async () => {
    const { client, starts } = await holding();
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/chats', provider: 'claude' } });
    await settle();
    // A worker, opened by the backend on the start the host handed it, which is
    // how a chat a tool started comes to exist at all.
    const worker = starts.at(-1)?.subagent?.('toolu_task', { title: 'Explore', prompt: 'list the files' });
    await settle();
    expect(worker).toBeDefined();

    // It is a chat of the session - the catalogue names it, so a client can
    // open it - and it is still not one to attach: a tool made it, and it is
    // read-only. The only row that is not the chat the session hands out, since
    // this session has no other.
    const session = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/chats' } }) as {
      snapshot: { state: { defaultChat: string; chats: { resource: string; origin?: { kind?: string } }[] } };
    }).snapshot.state;
    const row = session.chats?.find((one) => one.resource !== session.defaultChat);
    expect(row?.resource).toBeDefined();
    expect(row?.origin?.kind).toBe('tool');

    // Said for the word its own title is, too: the filter matches a chat nobody
    // may attach, and the answer is nothing rather than the worker.
    expect(await completing(client, 'ahp-session:/chats', 'tell #chat:Explore')).toEqual([]);
  });

  /*
   * VS Code's provider pins a chat to its last completed turn and skips one
   * with none.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChatCompletionProvider.ts#L170-L195
   */
  it('pins a chat to the last turn it finished, and skips one that has none, as VS Code\'s provider', async () => {
    const { client } = await holding();
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/chats', provider: 'claude' } });
    await client.handle({ method: 'createChat', params: { channel: 'ahp-session:/chats', chat: 'ahp-chat:/review' } });
    await settle();
    await spoken(client, 'ahp-chat:/review', 't1', 'Review the diff');
    // And a chat that has said nothing yet, which has no turn to pin.
    await client.handle({ method: 'createChat', params: { channel: 'ahp-session:/chats', chat: 'ahp-chat:/blank' } });
    await settle();

    const found = await completing(client, 'ahp-session:/chats', 'tell #chat:');
    expect(found.map((one) => one.attachment)).toEqual([
      { type: 'chat', resource: 'ahp-chat:/review', endTurn: 't1', label: 'Review the diff' },
    ]);
  });

  it('answers a chat token with nothing where there is no session', async () => {
    const { client } = await holding();
    const found = await client.handle({
      method: 'completions',
      params: { channel: 'ahp-root://', kind: 'userMessage', text: 'tell #chat:', offset: 11 },
    }) as { items: unknown[] };
    // Nothing rather than a file whose name happens to begin with `chat:`: a
    // chat token is a chat asked for, and a channel with no session behind it
    // has no chats to offer - a path would attach the wrong thing and never say
    // so.
    expect(found.items).toEqual([]);
  });
});

describe('more than one directory', () => {
  // Folders the way this system spells them, outside the host's own path.
  const ONE = join(tmpdir(), 'ahpd-more-one');
  const TWO = join(tmpdir(), 'ahpd-more-two');
  const THREE = join(tmpdir(), 'ahpd-more-three');
  const EXTRA = join(tmpdir(), 'ahpd-more-extra');
  const ELSEWHERE = join(tmpdir(), 'ahpd-more-elsewhere');
  /*
   * A VS Code editor window, by the name it gives itself, and the multi-root
   * workspace it makes a session from: the two a window's folder change is
   * taken from, as VS Code's host takes one.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostClientInfo.ts#L8-L35
   */
  const EDITOR_WINDOW = {
    clientInfo: { name: 'vscode-editor-window', version: '1.0.0' },
    _meta: { 'vscode.ahpSessionUris': true, 'vscode.ahpChatUris': true },
  };
  const MULTI_ROOT = { multiRoot: { workspaceFile: uriOf(join(tmpdir(), 'ahpd-more.code-workspace')) } };

  /**
   * A first turn on a chat, run to its end: what makes a session ready for a
   * window's folder change. The CLI names the conversation `sdk-spoken` as it
   * starts, which is the name a resume asks for once the CLI has written it.
   */
  const spoken = async (client: { handle(r: { method: string; params: unknown }): unknown }, chatUri: string): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 'first', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } },
    });
    await settle();
    await emit({ type: 'system', subtype: 'init', session_id: 'sdk-spoken' });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
    await settle(8);
  };

  /** A window's session over the given folders, made from a multi-root workspace or not, and spoken in. */
  const windowed = async (folders: string[], multiRoot = true, over: Partial<HostOptions> = {}) => {
    const host = serving(WORK, [], over);
    const p = peer();
    p.request = async () => ({ trusted: true });
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], EDITOR_WINDOW));
    const uri = 'ahp-session:/windowed';
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'claude', workingDirectories: folders.map(uriOf), ...(multiRoot ? { _meta: MULTI_ROOT } : {}) },
    });
    const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    await spoken(client, chatUri);
    return { host, client, peer: p, uri, chatUri };
  };

  /** What `channel` was told of the folder actions, with the sender's number and any refusal. */
  const folderActions = (p: ReturnType<typeof peer>, channel: string) => actions(p, channel)
    .filter((one) => String(one.action.type).startsWith('session/workingDirectory'))
    .map((one) => [one.action.type, one.origin?.clientSeq, one.rejectionReason]);

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
    const host = serving(WORK);
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/wide', provider: 'claude',
        workingDirectories: [uriOf(ONE), uriOf(TWO)],
      },
    });
    await sendAnswered(client, 'ahp-session:/wide');
    // The first is the process root; the rest are its peers, which the SDK
    // takes at startup as `additionalDirectories`.
    expect(sessionQueries().at(-1)?.options.cwd).toBe(ONE);
    expect(sessionQueries().at(-1)?.options.additionalDirectories).toEqual([TWO]);
    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/wide' } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    expect(state.workingDirectories).toEqual([uriOf(ONE), uriOf(TWO)]);
  });

  it('says a directory added to a running session at once, and starts the agent again in it, resumed, at the next turn', async () => {
    const { client, uri, chatUri, peer: p } = await windowed([ONE]);
    wrote('sdk-spoken', String(sessionQueries().at(-1)?.options.cwd));
    const before = sessionQueries().length;
    await client.handle({ method: 'dispatchAction', params: { channel: uri, clientSeq: 1, action: { type: 'session/workingDirectorySet', directory: uriOf(EXTRA) } } });
    await settle(8);
    // Said at once, as VS Code's host applies it, with nothing started yet.
    expect(folderActions(p, uri)).toEqual([['session/workingDirectorySet', 1, undefined]]);
    expect(sessionQueries().length).toBe(before);

    await client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go on' } } },
    });
    await settle(8);
    /*
     * A new CLI, on the same conversation, at the turn boundary: the SDK takes
     * its directories when the process starts and offers no way to add one
     * after, so it starts again and *resumes*, the same conversation in a
     * wider place.
     */
    expect(sessionQueries().length).toBe(before + 1);
    expect(sessionQueries().at(-1)?.options.additionalDirectories).toEqual([EXTRA]);
    expect(sessionQueries().at(-1)?.options.resume).toBeDefined();
  });

  it('refuses to remove the directory the agent runs in, in VS Code\'s words', async () => {
    const { client, uri, peer: p } = await windowed([ONE, TWO]);
    await client.handle({ method: 'dispatchAction', params: { channel: uri, clientSeq: 2, action: { type: 'session/workingDirectoryRemoved', directory: uriOf(ONE) } } });
    await settle();
    expect(folderActions(p, uri)).toEqual([['session/workingDirectoryRemoved', 2, 'The primary working directory cannot be removed.']]);
  });

  /*
   * A window's folder change on VS Code's conditions, refused in its words
   * where they do not hold: from an editor window, on the session's channel,
   * for a session made from a multi-root workspace.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L13634-L13650
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12669-L12689
   */
  it('takes a folder change from an editor window, on the session channel, for a session made from a multi-root workspace', async () => {
    const { host, client, uri, chatUri, peer: p } = await windowed([ONE]);
    const before = sessionQueries().length;
    // A client that is no editor window.
    const other = peer();
    const plain = host.accept(other);
    await plain.handle(hello(['0.9.0'], { clientId: 'plain' }));
    await plain.handle({ method: 'subscribe', params: { channel: uri } });
    await plain.handle({ method: 'dispatchAction', params: { channel: uri, clientSeq: 3, action: { type: 'session/workingDirectorySet', directory: uriOf(EXTRA) } } });
    // The editor window, on the chat's channel.
    await client.handle({ method: 'dispatchAction', params: { channel: chatUri, clientSeq: 4, action: { type: 'session/workingDirectorySet', directory: uriOf(EXTRA) } } });
    await settle(8);
    expect(folderActions(other, uri)).toEqual([['session/workingDirectorySet', 3, 'Session working-directory actions require an Editor Window client.']]);
    expect(folderActions(p, chatUri)).toEqual([['session/workingDirectorySet', 4, 'Session working-directory actions require a session channel.']]);

    // A session the window made from no multi-root workspace.
    const single = await windowed([ONE], false);
    await single.client.handle({ method: 'dispatchAction', params: { channel: single.uri, clientSeq: 5, action: { type: 'session/workingDirectorySet', directory: uriOf(EXTRA) } } });
    await settle(8);
    expect(folderActions(single.peer, single.uri)).toEqual([
      ['session/workingDirectorySet', 5, `Session does not support dynamic working-directory changes: ${single.uri}`],
    ]);
    expect(sessionQueries().length).toBe(before + 1);
  });

  /*
   * A workspace-less session takes no folder change, made from a multi-root
   * workspace or not, as VS Code's host refuses one.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L12675-L12682
   */
  it('refuses a folder change to a workspace-less session, in VS Code\'s words', async () => {
    const home = mkdtempSync(join(tmpdir(), 'ahpd-home-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    onTestFinished(async () => {
      vi.unstubAllEnvs();
      await rm(home, { recursive: true, force: true });
    });
    const scratch = await windowed([], true, { workspacelessFolder: 'scratch' });
    await scratch.client.handle({ method: 'dispatchAction', params: { channel: scratch.uri, clientSeq: 1, action: { type: 'session/workingDirectorySet', directory: uriOf(EXTRA) } } });
    await settle(8);
    expect(folderActions(scratch.peer, scratch.uri)).toEqual([
      ['session/workingDirectorySet', 1, `Session does not support dynamic working-directory changes: ${scratch.uri}`],
    ]);
  });

  /*
   * The chat half of the same feature.
   *
   * A chat may hold fewer directories than its session, never more: the
   * session's set is what the person opened, and a chat that could widen it
   * would be a chat granting itself access to a folder nobody chose.
   */
  const wide = async () => {
    // Each chat's CLI starts at its first send, so a test counts the ones its sends start.
    const host = serving(WORK, [], startedBySend());
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], EDITOR_WINDOW));
    const uri = 'ahp-session:/split';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'claude',
        workingDirectories: [uriOf(ONE), uriOf(TWO), uriOf(THREE)],
        _meta: MULTI_ROOT,
      },
    });
    return { host, client, peer: p, uri };
  };

  it('opens a chat in the subset it was asked for, and says so on the chat', async () => {
    const { client, uri } = await wide();
    const chat = 'ahp-chat:/narrow';
    await client.handle({
      method: 'createChat',
      params: { channel: uri, chat, workingDirectories: [uriOf(ONE), uriOf(THREE)] },
    });
    await sendAnswered(client, chat);
    // The first entry is the session's process root and is not a choice; what
    // a chat picks among is the peers, and the CLI takes those at startup.
    expect(sessionQueries().at(-1)?.options.cwd).toBe(ONE);
    expect(sessionQueries().at(-1)?.options.additionalDirectories).toEqual([THREE]);
    const state = (await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    expect(state.workingDirectories).toEqual([uriOf(ONE), uriOf(THREE)]);
  });

  it('refuses to open a chat somewhere the session is not', async () => {
    const { client, uri } = await wide();
    await expect(client.handle({
      method: 'createChat',
      params: { channel: uri, chat: 'ahp-chat:/stray', workingDirectories: [uriOf(ELSEWHERE)] },
    })).rejects.toThrow(/is not a working directory of/);
  });

  /*
   * A chat's own folder actions are refused in VS Code's words, whatever they
   * name, and start nothing: VS Code's host serves neither.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L139-L142
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2813-L2815
   */
  it('refuses a chat\'s own folder actions, as VS Code does, starting nothing', async () => {
    const { client, peer: p, uri } = await wide();
    const chat = 'ahp-chat:/narrow';
    await client.handle({
      method: 'createChat',
      params: { channel: uri, chat, workingDirectories: [uriOf(ONE), uriOf(THREE)] },
    });
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    const before = sessionQueries().length;
    await send(client, chat, 12, { type: 'chat/workingDirectorySet', directory: uriOf(TWO) });
    await send(client, chat, 13, { type: 'chat/workingDirectoryRemoved', directory: uriOf(THREE) });
    await settle(8);

    const answered = actions(p, chat).filter((one) => String(one.action.type).startsWith('chat/workingDirectory'));
    expect(answered.map((one) => [one.action.type, one.origin?.clientSeq, one.rejectionReason])).toEqual([
      ['chat/workingDirectorySet', 12, 'Unsupported action: chat/workingDirectorySet'],
      ['chat/workingDirectoryRemoved', 13, 'Unsupported action: chat/workingDirectoryRemoved'],
    ]);
    expect(sessionQueries().length).toBe(before);
  });

  /*
   * Each action as the protocol's reducers apply it: a set adds a folder the
   * set lacks, a removal takes out one it holds, and a replacement swaps the
   * entry `directory` names for the folder `replacement` carries. An action
   * that would change nothing starts nothing, and goes to every client of
   * the channel as the sender's own.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/actions.ts
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts
   */
  const watched = async () => {
    const opened = await wide();
    opened.peer.request = async () => ({ trusted: true });
    return opened;
  };

  /** One client action on `channel`, under `clientSeq`. */
  const send = (client: { handle(r: { method: string; params: unknown }): unknown }, channel: string, clientSeq: number, action: Record<string, unknown>) =>
    client.handle({ method: 'dispatchAction', params: { channel, clientSeq, action } });

  /** The session's folders, as a client reading its state sees them. */
  const foldersOf = async (client: { handle(r: { method: string; params: unknown }): unknown }, uri: string): Promise<string[]> =>
    (await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: { workingDirectories: string[] } } })
      .snapshot.state.workingDirectories;

  it('says a folder set again, one removed that is not there, and a replacement of one that is not there, to every client, starting nothing', async () => {
    const { host, client, peer: p, uri } = await watched();
    const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    await spoken(client, chatUri);
    const other = peer();
    const watching = host.accept(other);
    await watching.handle(hello(['0.9.0'], { clientId: 'other' }));
    await watching.handle({ method: 'subscribe', params: { channel: uri } });
    await sendAnswered(client, uri);
    const before = sessionQueries().length;
    await send(client, uri, 4, { type: 'session/workingDirectorySet', directory: uriOf(TWO) });
    await send(client, uri, 5, { type: 'session/workingDirectoryRemoved', directory: uriOf(ELSEWHERE) });
    await send(client, uri, 6, { type: 'session/workingDirectoryReplaced', directory: uriOf(ELSEWHERE), replacement: uriOf(EXTRA) });
    await settle(8);

    // Each is the sender's own action, and each goes to every client of the
    // session as the sender's: none of them restarts anything.
    for (const q of [p, other]) {
      const answered = actions(q, uri).filter((one) => String(one.action.type).startsWith('session/workingDirectory'));
      expect(answered.map((one) => [one.action.type, one.origin?.clientSeq, one.rejectionReason])).toEqual([
        ['session/workingDirectorySet', 4, undefined],
        ['session/workingDirectoryRemoved', 5, undefined],
        ['session/workingDirectoryReplaced', 6, undefined],
      ]);
    }
    expect(sessionQueries().length).toBe(before);
    expect(await foldersOf(client, uri)).toEqual([uriOf(ONE), uriOf(TWO), uriOf(THREE)]);
  });

  it('replaces the first folder with the one a replacement carries, and keeps the rest', async () => {
    const { client, peer: p, uri } = await watched();
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    await send(client, uri, 7, { type: 'session/workingDirectoryReplaced', directory: uriOf(ONE), replacement: uriOf(EXTRA) });
    await settle(8);
    await sendAnswered(client, uri);

    expect(sessionQueries().at(-1)?.options.cwd).toBe(EXTRA);
    expect(sessionQueries().at(-1)?.options.additionalDirectories).toEqual([TWO, THREE]);
    expect(await foldersOf(client, uri)).toEqual([uriOf(EXTRA), uriOf(TWO), uriOf(THREE)]);
    // The move as the host made it, then the client's own action as its answer.
    const said = actions(p, uri).filter((one) => one.action.type === 'session/workingDirectoryReplaced');
    expect(said.map((one) => [one.action.directory, one.action.replacement, one.origin?.clientSeq])).toEqual([
      [uriOf(ONE), uriOf(EXTRA), undefined],
      [uriOf(ONE), uriOf(EXTRA), 7],
    ]);
  });

  it('replaces a folder after the first in its place', async () => {
    const { client, uri } = await watched();
    await send(client, uri, 8, { type: 'session/workingDirectoryReplaced', directory: uriOf(TWO), replacement: uriOf(EXTRA) });
    await settle(8);
    await sendAnswered(client, uri);

    expect(sessionQueries().at(-1)?.options.cwd).toBe(ONE);
    expect(sessionQueries().at(-1)?.options.additionalDirectories).toEqual([EXTRA, THREE]);
    expect(await foldersOf(client, uri)).toEqual([uriOf(ONE), uriOf(EXTRA), uriOf(THREE)]);
  });

  it('moves a replacement the set already holds into the place it replaces, as the reducer does', async () => {
    const { client, peer: p, uri } = await watched();
    const asked: string[] = [];
    p.request = async (method) => { asked.push(method); return { trusted: true }; };
    await send(client, uri, 9, { type: 'session/workingDirectoryReplaced', directory: uriOf(ONE), replacement: uriOf(THREE) });
    await settle(8);
    await sendAnswered(client, uri);

    // The protocol's own example: [A, B, C] with A -> C becomes [C, B].
    expect(await foldersOf(client, uri)).toEqual([uriOf(THREE), uriOf(TWO)]);
    expect(sessionQueries().at(-1)?.options.cwd).toBe(THREE);
    // A folder the session already holds is no folder entered.
    expect(asked).toEqual([]);
  });

  it('refuses an action that names no folder', async () => {
    const { client, peer: p, uri } = await watched();
    await send(client, uri, 10, { type: 'session/workingDirectorySet' });
    await send(client, uri, 11, { type: 'session/workingDirectoryReplaced', directory: uriOf(TWO) });
    await settle(8);

    const refused = actions(p, uri).filter((one) => one.rejectionReason !== undefined);
    expect(refused.map((one) => [one.action.type, one.origin?.clientSeq])).toEqual([
      ['session/workingDirectorySet', 10],
      ['session/workingDirectoryReplaced', 11],
    ]);
  });

});

describe('the repository a session\'s machine is handed', () => {
  let dirs: string[] = [];
  afterEach(async () => {
    // Awaited rather than sync: on Windows a folder stays held until what the
    // test opened there is let go, which happens on the event loop a sync
    // retry blocks.
    for (const dir of dirs) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
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
        params: { channel: 'ahp-session:/git', provider: 'echo', workingDirectories: [uriOf(folder)], config: { computer } },
      });
      await settle();
    };
    return { root, asked, questions, lines, start };
  };

  it('hands a worktree session the git directory it belongs to', async () => {
    const { root, asked, start } = await hosted(async (dir) => ({ gitDir: '/repo/.git', worktreeDir: '/repo/.git/worktrees/tree', repository: dir }));
    await start(root);
    expect(asked[0]).toMatchObject({ folder: root, gitDir: '/repo/.git' });
    expect(asked[0]?.repository).toBeUndefined();
  });

  it('hands a session at the repository root its git directory, and no root', async () => {
    const { root, asked, start } = await hosted(async (dir) => ({ gitDir: join(dir, '.git'), worktreeDir: join(dir, '.git'), repository: dir }));
    await start(root);
    // Inside the folder, so it adds no mount; the machine still guards it.
    expect(asked[0]).toMatchObject({ folder: root, gitDir: join(root, '.git') });
    expect(asked[0]?.repository).toBeUndefined();
  });

  it('hands a session in a subfolder the repository root to mount', async () => {
    const { root, asked, start } = await hosted(async (dir) => ({ gitDir: join(dir, '..', '.git'), worktreeDir: join(dir, '..', '.git'), repository: join(dir, '..') }));
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
    const { root, asked, questions, start } = await hosted(async (dir) => ({ gitDir: '/repo/.git', worktreeDir: '/repo/.git/worktrees/tree', repository: dir }));
    const other = join(root, 'other');
    mkdirSync(other);
    await start(root, `devcontainer://${other}`);
    expect(questions).toEqual([other]);
    expect(asked[0]).toMatchObject({ source: `devcontainer://${other}`, gitDir: '/repo/.git' });
  });
});

/*
 * A session entering a folder, and the window that has to vouch for it.
 *
 * Trust is a window's rather than a folder's: it arrives on a connection, it
 * names the folders that window has opened, and a folder nobody has vouched for
 * is one a session must not walk into on its own. So the host asks the
 * connection whose turn asked for the move, and goes on only where the answer
 * was yes.
 *
 * `set_workspace` is the host's own tool, so it is called here the way a model
 * calls it: through the MCP server the backend was handed, from inside a turn,
 * with the turn ended afterwards - because that is the moment the move is made.
 */
describe('a session entering a folder nobody vouched for', () => {
  let dirs: string[] = [];
  afterEach(async () => {
    // Awaited rather than sync: on Windows a folder stays held until what the
    // test opened there is let go, which happens on the event loop a sync
    // retry blocks.
    for (const dir of dirs) await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    dirs = [];
  });

  /** Two folders side by side, one of them the session's own. */
  const folders = () => {
    const root = mkdtempSync(join(tmpdir(), 'ahpd-vouched-'));
    dirs.push(root);
    const here = join(root, 'one');
    const there = join(root, 'two');
    mkdirSync(here);
    mkdirSync(there);
    return { here, there };
  };

  /** One question the host put to the client. */
  type Asked = { method: string; params: Record<string, unknown> };

  /**
   * A host with one client, one session in `here`, and the host's own tools.
   *
   * `answer` is what the client says when the host asks it something; the
   * default is the window that trusts whatever it is asked about. `trusts` is
   * what that window pushed on connecting, which is the same answer arriving
   * the other way round - a push says it for good, an answer only for the
   * folder in hand.
   */
  const hosted = async (here: string, {
    trusts = [], answer = () => ({ trusted: true }), root = {}, autoApprove, isolation, worktrees, window = false,
    multipleDirectories = false,
  }: {
    trusts?: string[];
    answer?: (asked: Asked) => unknown;
    root?: Record<string, unknown>;
    autoApprove?: string;
    isolation?: string;
    worktrees?: Worktrees;
    /**
     * Whether the client is a VS Code editor window making the session from a
     * multi-root workspace, the one a session's folders are set by.
     */
    window?: boolean;
    /**
     * Whether the agent works in more than one folder, which a session's
     * folders are changed in. Off by default, so a move here is a session's.
     */
    multipleDirectories?: boolean;
  } = {}) => {
    const asked: Asked[] = [];
    const lines: string[] = [];
    const p = peer();
    p.request = async (method, params) => {
      const one = { method, params: params as Record<string, unknown> };
      asked.push(one);
      return answer(one);
    };
    const host = createHost({
      path: here,
      // An agent with one folder for its session, so these cases are the
      // session's move: the trust and worktree questions are the same on a
      // chat's, and that move is set out in host-tools.test.ts.
      agents: [{ ...claude({ paths: [here] }), multipleDirectories }],
      ...machine(),
      ...(worktrees === undefined ? {} : { worktrees }),
      tools: hostTools(),
      onEvent: (line) => { lines.push(line); },
    });
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], {
      initialSubscriptions: ['ahp-root://'],
      ...(window ? {
        clientInfo: { name: 'vscode-editor-window', version: '1.0.0' },
        _meta: { 'vscode.ahpSessionUris': true, 'vscode.ahpChatUris': true },
      } : {}),
    }));
    await client.handle({
      method: 'dispatchAction',
      params: {
        channel: 'ahp-root://',
        action: {
          type: 'root/configChanged',
          config: { workspaceTrust: { enabled: true, trustedUris: trusts.map(uriOf) }, ...root },
        },
      },
    });
    const uri = 'ahp-session:/moves';
    await client.handle({
      method: 'createSession',
      params: {
        channel: uri, provider: 'claude', workingDirectories: [uriOf(here)],
        ...(window ? { _meta: { multiRoot: { workspaceFile: uriOf(join(here, 'vouched.code-workspace')) } } } : {}),
        ...(autoApprove === undefined && isolation === undefined ? {} : {
          config: {
            ...(autoApprove === undefined ? {} : { autoApprove }),
            ...(isolation === undefined ? {} : { isolation }),
          },
        }),
      },
    });
    const chatUri = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { defaultChat: string } };
    }).snapshot.state.defaultChat;
    await client.handle({ method: 'subscribe', params: { channel: chatUri } });
    /** The host's `set_workspace`, called from a turn, then that turn ended. */
    const move = async (folder: string, isolation = false): Promise<void> => {
      await client.handle({
        method: 'dispatchAction',
        params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: `work in ${folder}` } } },
      });
      await settle();
      const host = builtServer('host') as {
        tools: { name: string; handler: (input: unknown) => Promise<{ content: { text: string }[] }> }[];
      } | undefined;
      const tool = host?.tools.find((one) => one.name === 'set_workspace');
      if (!tool) throw new Error('the host offered no set_workspace');
      await tool.handler({ workspaceFolder: folder, isolation });
      // The move is made when the turn that asked for it is over, and not
      // before: the agent is started again there, and a restart mid-turn is a
      // turn that never finishes.
      await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });
      await settle(8);
    };
    /** Where the session is, as the last CLI started for it was told. */
    const cwd = (): string | undefined => sessionQueries().at(-1)?.options.cwd as string | undefined;
    return { client, peer: p, asked, lines, uri, chatUri, move, cwd };
  };

  /** Whether the session was announced as having moved, from where and to where. */
  const moved = (p: ReturnType<typeof peer>, uri: string): unknown[] =>
    actions(p, uri)
      .filter((one) => one.action.type === 'session/workingDirectoryReplaced')
      .map((one) => [one.action.directory, one.action.replacement]);

  it('asks the window, and stays where it is when the window says no', async () => {
    const { here, there } = folders();
    const { peer: p, asked, lines, uri, move, cwd } = await hosted(here, {
      trusts: [here],
      answer: () => ({ trusted: false }),
    });
    await move(there);

    // The folder is not one this window pushed, so it was asked - and told no,
    // which is the whole of what the window had to say about it.
    expect(asked).toEqual([{ method: 'vscode/requestWorkspaceTrust', params: { workspace: uriOf(there) } }]);
    expect(moved(p, uri)).toEqual([]);
    // The session is still where it was, still running, and the failure is in
    // the log rather than in a client's lap: nobody is waiting on a move.
    expect(cwd()).toBe(here);
    expect(lines.some((line) => line.includes(`Workspace trust was not granted for '${there}'`))).toBe(true);
  });

  it('moves where the window says it trusts the folder', async () => {
    const { here, there } = folders();
    const { peer: p, uri, move, cwd } = await hosted(here, { trusts: [here] });
    await move(there);

    expect(moved(p, uri)).toEqual([[uriOf(here), uriOf(there)]]);
    expect(cwd()).toBe(there);
  });

  it('refuses a folder when the client does not serve the question at all', async () => {
    const { here, there } = folders();
    const { peer: p, asked, uri, move, cwd } = await hosted(here, {
      trusts: [here],
      // What a client without the extension method answers: JSON-RPC's own
      // "no such method" for the `vscode/` surface it does not implement.
      answer: () => { throw Object.assign(new Error('no such method'), { code: -32601 }); },
    });
    await move(there);

    expect(asked).toHaveLength(1);
    expect(moved(p, uri)).toEqual([]);
    expect(cwd()).toBe(here);
  });

  it('asks nothing when the host is set to approve everything', async () => {
    const { here, there } = folders();
    const { peer: p, asked, uri, move, cwd } = await hosted(here, {
      trusts: [here],
      root: { globalAutoApproveEnabled: true },
    });
    await move(there);

    expect(asked).toEqual([]);
    expect(moved(p, uri)).toEqual([[uriOf(here), uriOf(there)]]);
    expect(cwd()).toBe(there);
  });

  it('asks nothing when the session itself is set to auto-approve', async () => {
    const { here, there } = folders();
    const { asked, uri, move, cwd } = await hosted(here, { trusts: [here], autoApprove: 'autoApprove' });
    await move(there);

    expect(asked).toEqual([]);
    expect(cwd()).toBe(there);
  });

  /*
   * The worktree a move makes is asked about before it is made, with the
   * repository it is cut from as the trusted parent a window trusts it by, as
   * VS Code's host asks the client that started a conversion.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionWorkspaceConversion/sessionWorkspaceConversionService.ts#L975-L977
   */
  it('asks about the folder and then the worktree it makes from it, the folder its trusted parent', async () => {
    const { here, there } = folders();
    const created: { repository: string; path: string }[] = [];
    const worktrees: Worktrees = {
      repository: async (dir) => dir,
      branches: async () => ['main'],
      create: async (one) => { created.push(one); },
      dirty: async () => false,
      remove: async () => {},
      gitDir: async () => undefined,
    };
    const { asked, move, cwd } = await hosted(here, { trusts: [here], worktrees });
    await move(there, true);

    // The folder the session was sent to, and then the worktree in that
    // folder's `<repo>.worktrees`, with the folder as its trusted parent.
    expect(created).toHaveLength(1);
    expect(created[0]?.repository).toBe(there);
    expect(asked).toEqual([
      { method: 'vscode/requestWorkspaceTrust', params: { workspace: uriOf(there) } },
      { method: 'vscode/requestWorkspaceTrust', params: { workspace: uriOf(String(created[0]?.path)), trustedParent: uriOf(there) } },
    ]);
    // And the session runs in it.
    expect(String(cwd())).toContain('two.worktrees');
  });

  it('keeps the tree a session worked in when it moves, and removes it with the session', async () => {
    const { here, there } = folders();
    const created: { path: string; branch?: string }[] = [];
    const removed: string[] = [];
    const worktrees: Worktrees = {
      repository: async (dir) => dir,
      branches: async () => ['main'],
      create: async (one) => { created.push(one); },
      dirty: async () => false,
      head: async (path) => created.find((one) => one.path === path)?.branch,
      remove: async (_repository, path) => { removed.push(path); },
      gitDir: async () => undefined,
    };
    const { client, uri, move, cwd } = await hosted(here, { trusts: [here, there], isolation: 'worktree', worktrees });
    await move(there);

    // The session runs in the folder it moved to, and the tree its turns ran
    // in is still on disk.
    expect(cwd()).toBe(there);
    expect(created).toHaveLength(1);
    expect(removed).toEqual([]);

    // And it is the session's: a clean one goes when the session does.
    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    await settle(8);
    expect(removed).toEqual([created[0]?.path]);
  });

  it('refuses a folder a window adds that nobody vouched for, and does not add it', async () => {
    const { here, there } = folders();
    const { client, peer: p, uri, chatUri } = await hosted(here, {
      trusts: [here], answer: () => ({ trusted: false }), window: true,
      // A folder is added to a session that works in more than one, which is
      // the agent's own answer.
      multipleDirectories: true,
    });
    // Ready from its first turn, which a working-directory change waits for.
    await firstMessage(client, chatUri);
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    const before = sessionQueries().length;
    await client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/workingDirectorySet', directory: uriOf(there) } },
    });
    await settle(8);

    const refused = actions(p, uri)
      .map((one) => one.rejectionReason)
      .filter((one): one is string => typeof one === 'string');
    expect(refused).toEqual([`Workspace trust was not granted for '${there}'`]);
    // Nothing started again, and the session still holds the one folder: a
    // refusal is the folder not being added, not the action being dropped.
    expect(sessionQueries().length).toBe(before);
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { workingDirectories: string[] } };
    }).snapshot.state;
    expect(state.workingDirectories).toEqual([uriOf(here)]);
  });
});
