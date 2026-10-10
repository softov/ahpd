import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * A call a person is being asked about, which holds the text the tool would leave.
 *
 * Nothing is written for this: the tool has not run, which is the whole point,
 * so the text exists only in what `propose` was handed and what it answers
 * with. A client reads it from the URI on the `after` side.
 */
describe('ahp-edit://pending, the file a tool would leave', () => {
  it('serves the text the tool would leave, until the call is settled', async () => {
    const file = join(scratch(), 'a file #1.md');
    writeFileSync(file, 'as it is\n');
    const source = gitChanges();
    const edit = await source.propose?.('', 'ahp-session:/s', 'toolu_1', file, (current) => `${current ?? ''}and more\n`);
    // The file itself, named as a `file:` URI, which is where a client reads
    // the side the tool would change rather than the one it would leave.
    expect(fileURLToPath(edit?.before?.uri as string)).toBe(file);
    expect(edit?.before?.content.uri).toBe(edit?.before?.uri);
    const after = edit?.after?.content.uri as string;
    expect(after.startsWith('ahp-edit://pending/')).toBe(true);
    expect(await text(source, after)).toBe('as it is\nand more\n');
    // And the form VS Code prints after parsing it.
    expect(await text(source, vscode(after))).toBe('as it is\nand more\n');
    source.settle?.('ahp-session:/s', 'toolu_1');
    expect(await text(source, after)).toBeUndefined();
  });

  it('leaves `before` out for a file that is not there, and holds no diff counts', async () => {
    const file = join(scratch(), 'new.md');
    const source = gitChanges();
    const edit = await source.propose?.('', 'ahp-session:/s', 'toolu_2', file, () => 'made\n');
    expect(edit?.before).toBeUndefined();
    expect(edit).not.toHaveProperty('diff');
    expect(await text(source, edit?.after?.content.uri as string)).toBe('made\n');
  });

  it('answers nothing for a change it cannot make out of the file', async () => {
    const file = join(scratch(), 'x.md');
    writeFileSync(file, 'as it is\n');
    const source = gitChanges();
    // What an `Edit` whose `old_string` is not in the file answers with.
    expect(await source.propose?.('', 'ahp-session:/s', 'toolu_3', file, () => undefined)).toBeUndefined();
  });

  it('holds one preview per call, and settles only the call it names', async () => {
    const file = join(scratch(), 'x.md');
    writeFileSync(file, 'as it is\n');
    const source = gitChanges();
    const edit = await source.propose?.('', 'ahp-session:/s', 'toolu_4', file, () => 'first\n');
    const before = edit?.after?.content.uri as string;
    // A second ask for the same call: one answer is being waited on, so the
    // text it minted before is not held beside this one.
    const again = await source.propose?.('', 'ahp-session:/s', 'toolu_4', file, () => 'second\n');
    const now = again?.after?.content.uri as string;
    expect(now).toBe(before);
    expect(await text(source, now)).toBe('second\n');
    // A different call is a different preview, and settling one leaves it.
    const other = await source.propose?.('', 'ahp-session:/s', 'toolu_5', file, () => 'other\n');
    const kept = other?.after?.content.uri as string;
    source.settle?.('ahp-session:/s', 'toolu_4');
    expect(await text(source, now)).toBeUndefined();
    expect(await text(source, kept)).toBe('other\n');
  });

  it('is what the host itself answers for, until the call is settled', async () => {
    const dir = scratch();
    const file = join(dir, 'a.md');
    writeFileSync(file, 'as it is\n');
    const changes = gitChanges();
    const host = createHost({ path: dir, agents: [echo({ path: dir })], changes });
    const client = host.accept({
      send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    });
    await client.handle({ method: 'initialize', params: { clientId: 'pending', protocolVersions: ['0.9.0'] } });

    // The card names a URI, and the client reading that URI is reading the
    // host: nobody wrote this text anywhere a filesystem could find it.
    const edit = await changes.propose?.(dir, 'ahp-session:/s', 'toolu_9', file, (current) => `${current ?? ''}and more\n`);
    const after = edit?.after?.content.uri as string;
    expect(await client.handle({
      method: 'resourceRead', params: { channel: 'ahp-root://', uri: after },
    })).toEqual({ data: 'as it is\nand more\n', encoding: 'utf-8' });

    changes.settle?.('ahp-session:/s', 'toolu_9');
    // Answered for while the question is open, and nobody's once it is not.
    await expect(client.handle({
      method: 'resourceRead', params: { channel: 'ahp-root://', uri: after },
    })).rejects.toMatchObject({ code: -32601 });
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

describe('the directory a session\'s changesets are of', () => {
  /**
   * A host rooted in a repository whose folder holds a `#`, and a session in it.
   *
   * The working directory the backend reports is the one it was started in,
   * which the echo agent spells the way a harness spells its own `cwd`:
   * `file://` and the path as it is. The changeset's directory is that URI read
   * back, so a reader that stops at the `#` answers a folder the session is not
   * in - and a folder that does not exist has no changeset at all.
   */
  const hashed = async () => {
    const root = scratch();
    const where = join(root, 'C#', 'app');
    mkdirSync(where, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main', where]);
    git(where, 'config', 'user.email', 'test@example.com');
    git(where, 'config', 'user.name', 'Test');
    writeFileSync(join(where, 'tracked.txt'), 'one\n');
    git(where, 'add', '-A');
    git(where, 'commit', '-q', '-m', 'first');
    // Dirty, so the working tree is worth a changeset at all.
    writeFileSync(join(where, 'tracked.txt'), 'two\n');
    const changes = gitChanges();
    const host = createHost({ path: where, agents: [echo({ path: where })], changes });
    const client = host.accept({
      send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    });
    await client.handle({ method: 'initialize', params: { clientId: 'hashed', protocolVersions: ['0.9.0'] } });
    const uri = 'ahp-session:/hashed';
    // No working directories given: the session works where the host is.
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
    await changes.refresh?.(where);
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { changesets?: { uriTemplate: string }[] } };
    }).snapshot.state;
    return { where, state };
  };

  it('is the folder the session is in, hash and all, so its changesets are there', async () => {
    const { where, state } = await hashed();
    expect(state.changesets?.map((one) => one.uriTemplate)).toContain('ahp-session:/hashed/changeset/uncommitted');
    expect(where).toContain('C#');
  });
});

describe('the changesets a session offers, in the order a client sees them', () => {
  /**
   * The working tree first, because a client that shows one changeset shows
   * the first - and VS Code offers Commit on the working tree alone.
   */
  it('lists the working tree, then the session, then the two templates', async () => {
    const dir = repository();
    const source = gitChanges();
    // The tree is read so the working tree has an entry, and a turn is
    // observed so the session's own changeset does. Both are needed before
    // the order is about anything.
    await source.refresh?.(dir);
    const file = join(dir, 'docs', 'AHP.md');
    source.observe?.(dir, 'ahp-session:/s', 't1', file, 'before');
    await settle();
    source.observe?.(dir, 'ahp-session:/s', 't1', file, 'after');
    await settle();
    expect(source.scopes(dir, 'ahp-session:/s').map((one) => one.id)).toEqual([
      'uncommitted',
      'session',
      'turn/{turnId}',
      'compare/{originalTurnId}/{modifiedTurnId}',
    ]);
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
