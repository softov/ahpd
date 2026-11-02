/*
 * A review: a client ticking the files of a changeset off, the one changeset
 * action a client originates.
 *
 * The protocol's reducer gives every listed file the changeset holds the flag
 * and ignores the rest, a changeset whose catalogue entry carries no review
 * capability is not reviewable, and the server resets a tick when it changes
 * the file under it. Every review is answered, with an echo carrying its
 * sender's origin or with a refusal.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/changesets.md
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { fileResources } from '../src/resources/resources.js';
import { uriOf } from '../src/resources/fileuri.js';
import { gitChanges } from '../src/sessions/changes.js';
import { echo } from '../../../examples/echo/agent.js';
import type { ChangesetFile, ChangesetSource } from '../src/types/changes.js';
import type { Bag } from '../src/types/common.js';
import type { Peer } from '../src/types/rpc.js';

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const runIn = (dir: string, ...args: string[]): void => { execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }); };

/** A repository with one commit on `main`. */
const repository = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-review-'));
  made.push(dir);
  runIn(dir, 'init', '-q', '-b', 'main');
  runIn(dir, 'config', 'user.email', 'test@example.com');
  runIn(dir, 'config', 'user.name', 'Test');
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  runIn(dir, 'add', '-A');
  runIn(dir, 'commit', '-q', '-m', 'base');
  return dir;
};

describe('what the source keeps', () => {
  it('reads a tick on a turn\'s changeset back', async () => {
    const dir = repository();
    const source = gitChanges();
    const path = join(dir, 'made.txt');
    writeFileSync(path, 'made\n');
    await source.observe?.(dir, 's1', 't1', path, 'before', '');
    await source.observe?.(dir, 's1', 't1', path, 'after', 'made\n');

    expect(source.review?.(dir, 's1', 'turn/t1', [uriOf(path)], true)).toBe(true);
    const state = await source.state(dir, 's1', 'turn/t1');
    expect(state?.files.map((file) => [file.id, file.reviewed])).toEqual([[uriOf(path), true]]);
  });

  it('lets a turn that changes a file again take the tick off its branch row', async () => {
    const dir = repository();
    runIn(dir, 'checkout', '-q', '-b', 'work');
    const path = join(dir, 'work.txt');
    writeFileSync(path, 'work\n');
    const source = gitChanges();
    await source.refresh?.(dir);
    const reviewed = async (): Promise<boolean | undefined> =>
      (await source.state(dir, 's1', 'branch', 'main'))?.files.find((file) => file.id === uriOf(path))?.reviewed;

    expect(source.review?.(dir, 's1', 'branch', [uriOf(path)], true)).toBe(true);
    expect(await reviewed()).toBe(true);
    // A file a turn has changed again is not the file that was reviewed.
    writeFileSync(path, 'work, again\n');
    await source.observe?.(dir, 's1', 't2', path, 'after', 'work, again\n');
    expect(await reviewed()).toBeUndefined();
  });

  it('keeps no tick on the working tree, and says why', async () => {
    const dir = repository();
    writeFileSync(join(dir, 'base.txt'), 'changed\n');
    const source = gitChanges();
    await source.refresh?.(dir);

    expect(source.review?.(dir, 's1', 'uncommitted', [uriOf(join(dir, 'base.txt'))], true)).toEqual(expect.any(String));
  });
});

/** An envelope as a client reads it. */
interface Heard {
  channel: string;
  action: Bag;
  origin?: { clientId: string; clientSeq: number };
  rejectionReason?: string;
}

const listening = (): Peer & { heard: Heard[] } => {
  const heard: Heard[] = [];
  return {
    heard,
    send: () => {},
    notify: (method, params) => { if (method === 'action') heard.push(params as Heard); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setTimeout(done, 0); });
};

const until = async (ready: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 400; i++) {
    if (ready()) return;
    await settle(1);
  }
  throw new Error(`${what} never happened`);
};

const SESSION = 'ahp-session:/s';
const CHANGESET = `${SESSION}/changeset/session`;
const [A, B, C] = ['a.txt', 'b.txt', 'c.txt'].map((name) => `file:///w/${name}`) as [string, string, string];
const ELSEWHERE = 'file:///w/elsewhere.txt';

/**
 * A session's changeset of three files, with the ticks a review leaves.
 *
 * `review` answers as the git source does: whether a tick moved, or the
 * sentence `refusing` gives. `edit` changes one file and fires the watch the
 * host opened, which is how a changeset moves under its watchers.
 */
const held = (options: { keeps?: boolean; refusing?: string } = {}) => {
  const ticked = new Set<string>();
  const diffs = new Map<string, number>([[A, 1], [B, 1], [C, 1]]);
  let fire: (() => void) | undefined;
  let moved = false;
  const files = (): ChangesetFile[] => [...diffs].map(([id, added]) => ({
    id,
    edit: { after: { uri: id, content: { uri: id } }, diff: { added, removed: 0 } },
    ...(ticked.has(id) ? { reviewed: true } : {}),
  }));
  const source: ChangesetSource = {
    scopes: () => [{ id: 'session', label: 'Session Changes', changeKind: 'session', reviewable: true }],
    state: async () => ({ status: 'ready', files: files() }),
    summary: () => ({ files: diffs.size }),
    refresh: async () => {
      const was = moved;
      moved = false;
      return was;
    },
    watch: (_dir, onChange) => {
      fire = onChange;
      return () => { fire = undefined; };
    },
    ...(options.keeps === false ? {} : {
      review: (_dir: string, _session: string, _scope: string, ids: string[], on: boolean): boolean | string => {
        if (options.refusing !== undefined) return options.refusing;
        let moving = false;
        for (const id of ids) {
          if (on && !ticked.has(id)) { ticked.add(id); moving = true; }
          if (!on && ticked.delete(id)) moving = true;
        }
        return moving;
      },
    }),
  };
  const edit = (id: string): void => {
    diffs.set(id, (diffs.get(id) ?? 0) + 1);
    moved = true;
    fire?.();
  };
  return { source, ticked, edit };
};

/** A host serving `source`, with two clients watching the session's changeset. */
const serving = async (source: ChangesetSource) => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-review-'));
  made.push(dir);
  const host = createHost({ path: dir, agents: [echo({ path: dir, pace: 0 })], resources: fileResources(), changes: source });
  const connect = async (clientId: string) => {
    const p = listening();
    const client = host.accept(p);
    await client.handle({ method: 'initialize', params: { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
    return { p, client };
  };
  const one = await connect('one');
  await one.client.handle({ method: 'createSession', params: { channel: SESSION, provider: 'echo' } });
  const two = await connect('two');
  await one.client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await two.client.handle({ method: 'subscribe', params: { channel: CHANGESET } });
  await settle();
  one.p.heard.length = 0;
  two.p.heard.length = 0;
  const review = (clientSeq: number, files: string[], reviewed = true) =>
    one.client.handle({ method: 'dispatchAction', params: { channel: CHANGESET, clientSeq, action: { type: 'changeset/filesReviewChanged', files, reviewed } } });
  const answer = (clientSeq: number): Heard | undefined =>
    one.p.heard.find((heard) => heard.channel === CHANGESET && heard.origin?.clientSeq === clientSeq);
  return { host, two: two.p, review, answer };
};

describe('what the host answers', () => {
  it('says a tick on a file already ticked to every watcher, writing nothing', async () => {
    const { source, ticked } = held();
    const { host, two, review, answer } = await serving(source);
    await review(1, [A]);
    await until(() => answer(1) !== undefined, 'the first answer');
    expect(two.heard.map((heard) => heard.action)).toEqual([{ type: 'changeset/filesReviewChanged', files: [A], reviewed: true }]);

    await review(2, [A]);
    await until(() => answer(2) !== undefined, 'the second answer');
    expect(answer(2)?.rejectionReason).toBeUndefined();
    await until(() => two.heard.length > 1, 'the second tick at the other watcher');
    expect(two.heard.map((heard) => heard.action)).toEqual([
      { type: 'changeset/filesReviewChanged', files: [A], reviewed: true },
      { type: 'changeset/filesReviewChanged', files: [A], reviewed: true },
    ]);
    expect([...ticked]).toEqual([A]);
    await host.close();
  });

  it('refuses a review of a changeset whose source keeps none', async () => {
    const { host, two, review, answer } = await serving(held({ keeps: false }).source);
    await review(1, [A]);
    await until(() => answer(1) !== undefined, 'the answer');
    expect(answer(1)?.rejectionReason).toEqual(expect.any(String));
    expect(two.heard).toEqual([]);
    await host.close();
  });

  it('refuses a review the source will not keep, in its words', async () => {
    const { host, two, review, answer } = await serving(held({ refusing: 'the working tree is whatever it is now' }).source);
    await review(1, [A]);
    await until(() => answer(1) !== undefined, 'the answer');
    expect(answer(1)?.rejectionReason).toBe('the working tree is whatever it is now');
    expect(two.heard).toEqual([]);
    await host.close();
  });

  it('ticks only the files the changeset holds, and says a review of none of them to every watcher, ticking nothing', async () => {
    const { source, ticked } = held();
    const { host, two, review, answer } = await serving(source);
    await review(1, [A, ELSEWHERE]);
    await until(() => answer(1) !== undefined, 'the first answer');
    expect(two.heard.map((heard) => heard.action)).toEqual([{ type: 'changeset/filesReviewChanged', files: [A], reviewed: true }]);
    expect([...ticked]).toEqual([A]);

    await review(2, [ELSEWHERE]);
    await until(() => answer(2) !== undefined, 'the second answer');
    expect(answer(2)?.rejectionReason).toBeUndefined();
    await until(() => two.heard.length > 1, 'the second review at the other watcher');
    expect(two.heard.at(-1)?.action).toEqual({ type: 'changeset/filesReviewChanged', files: [ELSEWHERE], reviewed: true });
    expect([...ticked]).toEqual([A]);
    await host.close();
  });

  it('says only the file that changed when the changeset next moves, after a tick and after a clear', async () => {
    const { source, edit } = held();
    const { host, two, review, answer } = await serving(source);
    const said = (): unknown[] => two.heard
      .filter((heard) => heard.channel === CHANGESET
        && heard.action.type !== 'changeset/statusChanged' && heard.action.type !== 'changeset/filesReviewChanged')
      .map((heard) => [heard.action.type, (heard.action.file as ChangesetFile | undefined)?.id]);

    await review(1, [A]);
    await until(() => answer(1) !== undefined, 'the tick');
    edit(B);
    await until(() => said().length > 0, 'the first change');
    await settle();
    expect(said()).toEqual([['changeset/fileSet', B]]);

    two.heard.length = 0;
    await review(2, [A], false);
    await until(() => answer(2) !== undefined, 'the clear');
    edit(C);
    await until(() => said().length > 0, 'the second change');
    await settle();
    expect(said()).toEqual([['changeset/fileSet', C]]);
    await host.close();
  });
});
