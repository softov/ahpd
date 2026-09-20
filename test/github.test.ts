import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubPullRequests } from '../packages/sdk/src/github.js';

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
          { html_url: 'https://github.com/softov/ahpd/pull/7', state: 'open', merged_at: null, title: 'Port the kqueue build' },
          { html_url: 'https://github.com/softov/ahpd/pull/2', state: 'closed', merged_at: null },
        ],
      };
    });
    const found = await githubPullRequests().forBranch({ owner: 'softov', repo: 'ahpd' }, 'fix/kqueue', 'gho_x', '/tmp');
    expect(found).toEqual([
      { url: 'https://github.com/softov/ahpd/pull/9', state: 'merged' },
      { url: 'https://github.com/softov/ahpd/pull/7', state: 'open', title: 'Port the kqueue build' },
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

  it('asks gh without a token, and reads its spelling of a state', async () => {
    const dir = fakeGh(JSON.stringify([
      { url: 'https://github.com/softov/ahpd/pull/7', state: 'OPEN', title: 'The fix', updatedAt: '2026-09-12T00:00:00Z' },
      { url: 'https://github.com/softov/ahpd/pull/9', state: 'MERGED', updatedAt: '2026-09-13T00:00:00Z' },
    ]));
    const found = await githubPullRequests().forBranch({ owner: 'softov', repo: 'ahpd' }, 'fix/kqueue', undefined, dir);
    expect(found).toEqual([
      { url: 'https://github.com/softov/ahpd/pull/9', state: 'merged' },
      { url: 'https://github.com/softov/ahpd/pull/7', state: 'open', title: 'The fix' },
    ]);
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(dir, 'asked'), 'utf8').trim())
      .toBe('pr list --repo softov/ahpd --head fix/kqueue --state all --limit 10 --json url,state,title,updatedAt');
  });

  it('says what gh said when gh could not answer', async () => {
    const dir = fakeGh('[]', 4);
    await expect(githubPullRequests().forBranch({ owner: 'softov', repo: 'ahpd' }, 'main', undefined, dir)).rejects.toThrow('not logged in');
  });
});
