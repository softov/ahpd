import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryAutomations } from '../src/automations.js';
import { gitChanges } from '../src/changes.js';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';

/*
 * The URIs a changeset mints, sent back the way a client sends them.
 *
 * A client that hands a URI back verbatim and one that parses and re-prints it
 * must open the same side. Git is real because `before` is `git show HEAD:`.
 */

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim();

/** A repository with `docs/AHP.md` and `docs/a file #1.md` committed, then both modified. */
const repository = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-uris-')));
  made.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs', 'AHP.md'), 'committed ahp\n');
  writeFileSync(join(dir, 'docs', 'a file #1.md'), 'committed spaced\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  writeFileSync(join(dir, 'docs', 'AHP.md'), 'changed ahp\n');
  writeFileSync(join(dir, 'docs', 'a file #1.md'), 'changed spaced\n');
  return dir;
};

/*
 * VS Code's `URI.parse(uri).toString()`, from `src/vs/base/common/uri.ts`.
 *
 * `_regexp` splits the URI and `percentDecode` decodes each part; `_asFormatted`
 * prints it again with `encodeURIComponentFast`, which keeps `/` literal in a
 * path and `:` in an authority, lowercases the authority and leaves `//` out
 * when the authority is empty.
 */

/** `_regexp`. */
const vscodeParts = /^(([^:/?#]+?):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;

/** `decodeURIComponentGraceful`. */
const decodeGraceful = (value: string): string => {
  try { return decodeURIComponent(value); }
  catch { return value.length > 3 ? value.slice(0, 3) + decodeGraceful(value.slice(3)) : value; }
};

/** `percentDecode`. */
const percentDecode = (value: string): string =>
  value.replace(/(%[0-9A-Za-z][0-9A-Za-z])+/g, (match) => decodeGraceful(match));

/** `encodeTable`. */
const encodeTable: Record<string, string> = {
  ':': '%3A', '/': '%2F', '?': '%3F', '#': '%23', '[': '%5B', ']': '%5D', '@': '%40',
  '!': '%21', '$': '%24', '&': '%26', '\'': '%27', '(': '%28', ')': '%29', '*': '%2A',
  '+': '%2B', ',': '%2C', ';': '%3B', '=': '%3D', ' ': '%20',
};

/** `encodeURIComponentFast`. */
const encodeFast = (value: string, isPath: boolean, isAuthority: boolean): string => {
  let out = '';
  let native = '';
  for (const char of value) {
    const plain = /[a-zA-Z0-9\-._~]/.test(char)
      || (isPath && char === '/')
      || (isAuthority && (char === '[' || char === ']' || char === ':'));
    const table = encodeTable[char];
    if (plain || table !== undefined) {
      out += encodeURIComponent(native);
      native = '';
      out += plain ? char : table;
    }
    else native += char;
  }
  return out + encodeURIComponent(native);
};

/** `_asFormatted(URI.parse(uri), false)`, with the windows drive letter rule and a userinfo left out. */
const vscode = (uri: string): string => {
  const match = vscodeParts.exec(uri);
  if (!match) return '';
  const scheme = match[2] ?? '';
  let authority = percentDecode(match[4] ?? '');
  const path = percentDecode(match[5] ?? '');
  const query = percentDecode(match[7] ?? '');
  const fragment = percentDecode(match[9] ?? '');
  let out = scheme ? `${scheme}:` : '';
  if (authority || scheme === 'file') out += '//';
  if (authority) {
    authority = authority.toLowerCase();
    const colon = authority.lastIndexOf(':');
    out += colon === -1
      ? encodeFast(authority, false, true)
      : encodeFast(authority.slice(0, colon), false, true) + authority.slice(colon);
  }
  if (path) out += encodeFast(path, true, false);
  if (query) out += `?${encodeFast(query, false, false)}`;
  if (fragment) out += `#${encodeFast(fragment, false, false)}`;
  return out;
};

describe('the normaliser, against VS Code run on the same URIs', () => {
  it('prints what VS Code printed', () => {
    expect(vscode('ahp-git:///github/ahpd/docs/AHP.md')).toBe('ahp-git:/github/ahpd/docs/AHP.md');
    expect(vscode('ahp-git:///github/ahpd/docs/a file #1.md')).toBe('ahp-git:/github/ahpd/docs/a%20file%20#1.md');
    expect(vscode('ahp-edit://cofold%3A%2FAbc-123/turn-1/before/w/x.md')).toBe('ahp-edit://cofold:/abc-123/turn-1/before/w/x.md');
    expect(vscode('ahp-git://head/github/ahpd/docs/AHP.md')).toBe('ahp-git://head/github/ahpd/docs/AHP.md');
    expect(vscode('ahp-edit://turn/cofold%3A%2FAbc-123/t1/before/w/x.md')).toBe('ahp-edit://turn/cofold%3A/Abc-123/t1/before/w/x.md');
  });
});

/** The text `read` answers for a URI, or `undefined`. */
const text = async (source: ReturnType<typeof gitChanges>, uri: string): Promise<string | undefined> =>
  (await source.read?.(uri))?.data;

describe('ahp-git:, a modified file as HEAD has it', () => {
  it('mints the before side under the `head` authority', async () => {
    const dir = repository();
    const source = gitChanges();
    await source.refresh?.(dir);
    const state = await source.state?.(dir, 'ahp-session:/s', 'uncommitted');
    const befores = (state?.files ?? []).map((one) => one.edit.before?.content?.uri);
    expect(befores).toHaveLength(2);
    for (const uri of befores) expect(uri?.startsWith('ahp-git://head/')).toBe(true);
    for (const uri of befores) expect(await text(source, uri as string)).toMatch(/^committed /);
  });

  it('reads the forms a client sends back, and the form minted before', async () => {
    const dir = repository();
    const source = gitChanges();
    await source.refresh?.(dir);
    expect(await text(source, `ahp-git:${dir}/docs/AHP.md`)).toBe('committed ahp\n');
    expect(await text(source, `ahp-git://${dir}/docs/AHP.md`)).toBe('committed ahp\n');
    expect(await text(source, `ahp-git://head${dir}/docs/AHP.md`)).toBe('committed ahp\n');
    expect(await text(source, `ahp-git:${dir}/docs/a%20file%20#1.md`)).toBe('committed spaced\n');
    expect(await text(source, `ahp-git://${dir}/docs/a file #1.md`)).toBe('committed spaced\n');
  });
});

/**
 * A source holding one turn's captured sides for `file`, and the URIs minted for them.
 *
 * `observe` reads the file from disk, so each side is written before it is observed.
 */
const captured = async (session: string, turn: string, file: string) => {
  const source = gitChanges();
  writeFileSync(file, 'as found\n');
  source.observe?.(dirOf(file), session, turn, file, 'before');
  await settle();
  writeFileSync(file, 'as left\n');
  source.observe?.(dirOf(file), session, turn, file, 'after');
  await settle();
  const state = await source.state?.(dirOf(file), session, `turn/${turn}`);
  const row = state?.files[0];
  return {
    source,
    before: row?.edit.before?.content?.uri as string,
    after: row?.edit.after?.content?.uri as string,
  };
};

const dirOf = (file: string): string => file.slice(0, file.lastIndexOf('/'));

/** Long enough for `observe`'s read and git's answer to land. */
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 100));

/** A scratch directory that is not a repository. */
const scratch = (): string => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-uris-')));
  made.push(dir);
  return dir;
};

describe('ahp-edit:, a turn\'s captured sides', () => {
  it('resolves a side from the URI minted and from the form VS Code sends back', async () => {
    const file = join(scratch(), 'a file #1.md');
    const { source, before, after } = await captured('cofold:/Abc-123', 't1', file);
    expect(before.startsWith('ahp-edit://turn/')).toBe(true);
    expect(await text(source, before)).toBe('as found\n');
    expect(await text(source, after)).toBe('as left\n');
    expect(await text(source, vscode(before))).toBe('as found\n');
    expect(await text(source, vscode(after))).toBe('as left\n');
  });

  it('resolves a side of a range of turns, whose scope has slashes, in VS Code\'s form', async () => {
    const file = join(scratch(), 'x.md');
    const { source } = await captured('cofold:/Abc-123', 't1', file);
    const state = await source.state?.(dirOf(file), 'cofold:/Abc-123', 'compare/t1/t1');
    const after = state?.files[0]?.edit.after?.content?.uri as string;
    expect(await text(source, after)).toBe('as left\n');
    expect(await text(source, vscode(after))).toBe('as left\n');
  });

  it('still resolves a side minted with the session as the authority, sent back as given', async () => {
    const file = join(scratch(), 'a file #1.md');
    const { source } = await captured('cofold:/Abc-123', 't1', file);
    const old = `ahp-edit://${encodeURIComponent('cofold:/Abc-123')}/${encodeURIComponent('t1')}/before${file}`;
    expect(await text(source, old)).toBe('as found\n');
  });
});

describe('a turn\'s line counts', () => {
  /** The session row's counts for `file`, taken from `from` to `to` in one turn; `undefined` is no file. */
  const counts = async (from: string | undefined, to: string) => {
    const file = join(scratch(), 'a.txt');
    const source = gitChanges();
    if (from !== undefined) writeFileSync(file, from);
    source.observe?.(dirOf(file), 'ahp-session:/s', 't1', file, 'before');
    await settle();
    writeFileSync(file, to);
    source.observe?.(dirOf(file), 'ahp-session:/s', 't1', file, 'after');
    await settle();
    const state = await source.state?.(dirOf(file), 'ahp-session:/s', 'session');
    return state?.files[0]?.edit.diff;
  };

  it('counts a created file ending in a newline by its lines', async () => {
    expect(await counts(undefined, 'a\nb\n')).toEqual({ added: 2, removed: 0 });
  });

  it('counts a created file with no final newline by its lines', async () => {
    expect(await counts(undefined, 'a\nb')).toEqual({ added: 2, removed: 0 });
  });

  it('counts a changed line once on each side', async () => {
    expect(await counts('a\nb\n', 'a\nc\n')).toEqual({ added: 1, removed: 1 });
  });
});

/** A host with an automation store, and one client introduced on `root`, the spelling it subscribes with. */
const introduced = async (root: string) => {
  const host = createHost({ path: '/tmp/ahpd-uris', agents: [echo({ path: '/tmp/ahpd-uris' })], automations: memoryAutomations() });
  const notes: { method: string; params: unknown }[] = [];
  const client = host.accept({
    send: () => {}, notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}), answered: () => {}, close: () => {},
  });
  const hello = await client.handle({
    method: 'initialize',
    params: { clientId: 'uris', protocolVersions: ['0.9.0'], initialSubscriptions: [root] },
  }) as { snapshots: { resource: string }[] };
  return { client, notes, hello };
};

describe('the host\'s channels, in the form VS Code prints them', () => {
  it('prints the root and the catalogue without their empty authority', () => {
    expect(vscode('ahp-root://')).toBe('ahp-root:');
    expect(vscode('ahp-automations://')).toBe('ahp-automations:');
  });

  it('takes `ahp-root:` as the root channel wherever it takes `ahp-root://`', async () => {
    for (const root of ['ahp-root://', vscode('ahp-root://')]) {
      const { client, notes, hello } = await introduced(root);
      expect(hello.snapshots.map((one) => one.resource)).toEqual([root]);
      const opened = await client.handle({ method: 'subscribe', params: { channel: root } }) as {
        snapshot: { resource: string; state: Record<string, unknown> };
      };
      expect(opened.snapshot.resource).toBe(root);
      expect(opened.snapshot.state.agents).toBeDefined();
      await expect(client.handle({ method: 'listSessions', params: { channel: root } })).resolves.toBeTruthy();
      await expect(client.handle({ method: 'listAutomationTriggerDefinitions', params: { channel: root } })).resolves.toBeTruthy();
      await client.handle({
        method: 'dispatchAction',
        params: { channel: root, clientSeq: 1, action: { type: 'root/configChanged', config: {} } },
      });
      const echoed = notes.filter((one) => one.method === 'action')
        .map((one) => one.params as { channel: string; action: { type: string } });
      expect(echoed.some((one) => one.channel === root && one.action.type === 'root/configChanged')).toBe(true);
      await client.handle({ method: 'unsubscribe', params: { channel: root } });
    }
  });

  it('takes `ahp-automations:` as the catalogue', async () => {
    const { client } = await introduced('ahp-root://');
    const channel = vscode('ahp-automations://');
    const opened = await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { resource: string } };
    expect(opened.snapshot.resource).toBe(channel);
    await expect(client.handle({
      method: 'fetchAutomationRuns', params: { channel, automation: 'ahp-automation:/nightly' },
    })).resolves.toBeTruthy();
  });

  it('prints every other URI the host mints as it was minted', () => {
    const id = '0b6c2f3e-8d1a-4c5b-9e7f-1a2b3c4d5e6f';
    const session = `ahp-session:/${id}`;
    const encoded = Buffer.from(session, 'utf8').toString('base64url');
    for (const uri of [
      session,
      `ahp-chat:/${id}`,
      `ahp-chat://default/${encoded}`,
      `ahp-chat://subagent/${encoded}/${encodeURIComponent('toolu_01AbCdEf')}`,
      `ahp-terminal:/${id}`,
      `ahp-automation:/nightly`,
      `ahp-automation-run:/${id}`,
      `ahp-resource-watch:/${id}`,
      'ahp-otlp://logs',
      'ahp-otlp://traces',
      'ahp-otlp://metrics',
      `${session}/changeset/uncommitted`,
      `${session}/changeset/turn/turn-1`,
    ]) expect(vscode(uri)).toBe(uri);
  });
});

describe('file:, a target an operation names', () => {
  /** `discard` on one resource of a directory's uncommitted changes. */
  const discard = (dir: string, resource: string) => {
    const source = gitChanges();
    if (source.invoke === undefined) throw new Error('gitChanges() no longer runs operations');
    return source.invoke({
      dir, session: 'ahp-session:/s', scope: 'uncommitted', operationId: 'discard',
      target: { kind: 'resource', resource },
    });
  };

  it('discards a file named in VS Code\'s encoded form', async () => {
    const dir = repository();
    await discard(dir, `file://${dir}/docs/a%20file%20%231.md`);
    expect(readFileSync(join(dir, 'docs', 'a file #1.md'), 'utf8')).toBe('committed spaced\n');
    expect(readFileSync(join(dir, 'docs', 'AHP.md'), 'utf8')).toBe('changed ahp\n');
  });

  it('refuses a target that leaves the directory by `..`', async () => {
    const dir = repository();
    await expect(discard(dir, `file://${dir}/../elsewhere.txt`)).rejects.toThrow('not in this directory');
  });
});
