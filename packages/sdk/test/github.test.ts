import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { posix } from '../../../tools/posix.ts';
import { githubPullRequests } from '../src/repo/github.js';

/*
 * The pull request of a branch, asked two ways.
 *
 * With a token it is the REST route the reference host takes, and the answer
 * is GitHub's own JSON; without one it is `gh`, whose JSON spells the state
 * differently. Both come out as the same three words, because the row that
 * draws them reads one spelling.
 */

let made: string[] = [];
const was = { path: process.env.PATH };
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
  process.env.PATH = was.path;
  vi.unstubAllGlobals();
});

/** A `gh` on the PATH that answers what it is told to, and records the call. */
const fakeGh = (answer: string, exit = 0): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-gh-'));
  made.push(dir);
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\necho "$@" > "${dir}/asked"\nif [ ${exit} -ne 0 ]; then echo 'gh: not logged in' >&2; exit ${exit}; fi\ncat <<'JSON'\n${answer}\nJSON\n`);
  chmodSync(join(dir, 'gh'), 0o755);
  process.env.PATH = `${dir}:${process.env.PATH ?? ''}`;
  return dir;
};

describe('the pull requests of a branch', () => {
  it('asks the API as the person who lent the token, and reads GitHub\'s own words', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, headers: init.headers });
      return {
        ok: true,
        status: 200,
        json: async () => [
          { html_url: 'https://github.com/softov/ahpd/pull/9', state: 'closed', merged_at: '2026-09-13T10:00:00Z' },
          { html_url: 'https://github.com/softov/ahpd/pull/7', state: 'open', merged_at: null, title: 'Port the kqueue build', created_at: '2026-09-01T08:00:00Z' },
          { html_url: 'https://github.com/softov/ahpd/pull/2', state: 'closed', merged_at: null },
        ],
      };
    });
    const found = await githubPullRequests().forBranch({ owner: 'softov', repo: 'ahpd' }, 'fix/kqueue', 'gho_x', '/tmp');
    // When each was opened too, which a session's baseline is read by.
    expect(found).toEqual([
      { url: 'https://github.com/softov/ahpd/pull/9', state: 'merged' },
      { url: 'https://github.com/softov/ahpd/pull/7', state: 'open', title: 'Port the kqueue build', createdAt: '2026-09-01T08:00:00Z' },
      { url: 'https://github.com/softov/ahpd/pull/2', state: 'closed' },
    ]);
    // The reference host's route: head as owner:branch, every state, newest update first.
    expect(calls[0]?.url).toBe('https://api.github.com/repos/softov/ahpd/pulls?head=softov%3Afix%2Fkqueue&state=all&sort=updated&direction=desc&per_page=10');
    expect(calls[0]?.headers.Authorization).toBe('Bearer gho_x');
  });

  it('says so when GitHub refuses, rather than answering none', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(githubPullRequests().forBranch({ owner: 'softov', repo: 'ahpd' }, 'main', 'bad', '/tmp')).rejects.toThrow('401');
  });

  // `fakeGh` puts a `#!/bin/sh` script first on `PATH`, and the host runs it:
  // a POSIX shell outside a terminal, which Windows has not.
  it.skipIf(!posix)('asks gh without a token, and reads its spelling of a state', async () => {
    const dir = fakeGh(JSON.stringify([
      { url: 'https://github.com/softov/ahpd/pull/7', state: 'OPEN', title: 'The fix', updatedAt: '2026-09-12T00:00:00Z', createdAt: '2026-09-01T08:00:00Z' },
      { url: 'https://github.com/softov/ahpd/pull/9', state: 'MERGED', updatedAt: '2026-09-13T00:00:00Z' },
    ]));
    const found = await githubPullRequests().forBranch({ owner: 'softov', repo: 'ahpd' }, 'fix/kqueue', undefined, dir);
    expect(found).toEqual([
      { url: 'https://github.com/softov/ahpd/pull/9', state: 'merged' },
      { url: 'https://github.com/softov/ahpd/pull/7', state: 'open', title: 'The fix', createdAt: '2026-09-01T08:00:00Z' },
    ]);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(dir, 'asked'), 'utf8').trim())
      .toBe('pr list --repo softov/ahpd --head fix/kqueue --state all --limit 10 --json url,state,title,updatedAt,createdAt');
  });

  // `fakeGh` puts a `#!/bin/sh` script first on `PATH`, and the host runs it:
  // a POSIX shell outside a terminal, which Windows has not.
  it.skipIf(!posix)('says what gh said when gh could not answer', async () => {
    const dir = fakeGh('[]', 4);
    await expect(githubPullRequests().forBranch({ owner: 'softov', repo: 'ahpd' }, 'main', undefined, dir)).rejects.toThrow('not logged in');
  });
});

describe('one pull request by its page', () => {
  it('asks the API for each page, and reads a merged, an open and a closed one', async () => {
    const asked: string[] = [];
    const answers: Record<string, unknown> = {
      '9': { html_url: 'https://github.com/softov/ahpd/pull/9', state: 'closed', merged_at: '2026-09-13T10:00:00Z', title: 'Merged' },
      '7': { html_url: 'https://github.com/softov/ahpd/pull/7', state: 'open', merged_at: null, title: 'Open' },
      '2': { html_url: 'https://github.com/softov/ahpd/pull/2', state: 'closed', merged_at: null, title: 'Closed' },
    };
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => {
      asked.push(`${url} ${init.headers.Authorization}`);
      const number = url.slice(url.lastIndexOf('/') + 1);
      const found = answers[number];
      return found === undefined
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => found };
    });
    const port = githubPullRequests();
    expect(await port.byUrl?.('https://github.com/softov/ahpd/pull/9', 'gho_x', '/tmp'))
      .toEqual({ url: 'https://github.com/softov/ahpd/pull/9', state: 'merged', title: 'Merged' });
    expect(await port.byUrl?.('https://github.com/softov/ahpd/pull/7', 'gho_x', '/tmp'))
      .toEqual({ url: 'https://github.com/softov/ahpd/pull/7', state: 'open', title: 'Open' });
    expect(await port.byUrl?.('https://github.com/softov/ahpd/pull/2/', 'gho_x', '/tmp'))
      .toEqual({ url: 'https://github.com/softov/ahpd/pull/2', state: 'closed', title: 'Closed' });
    // No pull request at the page, and a page that is not a pull request, are none.
    expect(await port.byUrl?.('https://github.com/softov/ahpd/pull/404', 'gho_x', '/tmp')).toBeUndefined();
    expect(await port.byUrl?.('https://example.com/softov/ahpd/pull/9', 'gho_x', '/tmp')).toBeUndefined();
    expect(asked).toEqual([
      'https://api.github.com/repos/softov/ahpd/pulls/9 Bearer gho_x',
      'https://api.github.com/repos/softov/ahpd/pulls/7 Bearer gho_x',
      'https://api.github.com/repos/softov/ahpd/pulls/2 Bearer gho_x',
      'https://api.github.com/repos/softov/ahpd/pulls/404 Bearer gho_x',
    ]);
  });

  it('says so when GitHub refuses, rather than answering none', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(githubPullRequests().byUrl?.('https://github.com/softov/ahpd/pull/9', 'bad', '/tmp')).rejects.toThrow('401');
  });

  // `fakeGh` puts a `#!/bin/sh` script first on `PATH`, and the host runs it:
  // a POSIX shell outside a terminal, which Windows has not.
  it.skipIf(!posix)('asks gh without a token, and reads its spelling of a state', async () => {
    const dir = fakeGh(JSON.stringify({ url: 'https://github.com/softov/ahpd/pull/9', state: 'MERGED', title: 'The fix' }));
    expect(await githubPullRequests().byUrl?.('https://github.com/softov/ahpd/pull/9', undefined, dir))
      .toEqual({ url: 'https://github.com/softov/ahpd/pull/9', state: 'merged', title: 'The fix' });
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(dir, 'asked'), 'utf8').trim()).toBe('pr view https://github.com/softov/ahpd/pull/9 --json url,state,title');
  });
});
