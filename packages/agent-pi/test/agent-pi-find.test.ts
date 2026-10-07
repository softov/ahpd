/*
 * One session's row, asked for by id rather than listed.
 *
 * What a client opening a row the host does not hold costs: `list` reads every
 * transcript in a project folder for one id, and `find` reads the one file pi's
 * `findById` names. The row it answers has to be the row `list` would have
 * answered - a difference is a client sent a `root/sessionSummaryChanged` for a
 * row that did not change - so the two are compared here rather than described.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { uriOf } from '@ahpd/sdk';
import { piAgent } from '../src/agent.js';
import { watch } from '../src/catalog.js';
import { loadPi } from '../src/pi.js';
import { root, sessionOnDisk } from './fake-pi.js';

/** The row a listing gives one session, and the row `find` gives for it. */
async function bothRows(sessionDir: string, name?: string) {
  const disk = await sessionOnDisk(sessionDir, name);
  const agent = piAgent({ sessionDir }, [root]);
  return {
    listed: (await agent.list?.())?.find((one) => one.id === disk.id),
    found: await agent.find?.(disk.id),
  };
}

it('answers a session on disk with the row the listing answers, named or not', async () => {
  const unnamed = await bothRows(join(root, 'pi'));
  expect(unnamed.listed).toBeDefined();
  expect(unnamed.found).toEqual(unnamed.listed);
  expect(unnamed.found?.title).toBe('read a.ts');

  const named = await bothRows(join(root, 'named'), 'a title pi kept');
  expect(named.found).toEqual(named.listed);
  expect(named.found?.title).toBe('a title pi kept');
});

it('answers nothing for an id no directory has', async () => {
  const sessionDir = join(root, 'pi');
  await sessionOnDisk(sessionDir);
  const agent = piAgent({ sessionDir }, [root]);
  expect(await agent.find?.('no-such-session')).toBeUndefined();
});

it('finds a session in the second of the directories it serves', async () => {
  const sessionDir = join(root, 'pi');
  const elsewhere = join(root, 'elsewhere');
  const disk = await sessionOnDisk(sessionDir);
  const agent = piAgent({ sessionDir }, [elsewhere, root]);
  expect((await agent.find?.(disk.id))?.id).toBe(disk.id);
});

it('answers a session this process is watching with the title a client set', async () => {
  const at = new Date().toISOString();
  watch('pi', {
    id: 'watched-1',
    title: 'a title a client set',
    createdAt: at,
    modifiedAt: at,
    directory: root,
    turns: [],
  });
  const agent = piAgent({ sessionDir: join(root, 'pi') }, [root]);
  expect(await agent.find?.('watched-1')).toEqual({
    id: 'watched-1',
    title: 'a title a client set',
    createdAt: at,
    modifiedAt: at,
    workingDirectories: [uriOf(root)],
  });
});

it('answers nothing, and makes nothing, for a file that is gone', async () => {
  const sessionDir = join(root, 'pi');
  const disk = await sessionOnDisk(sessionDir);
  const { SessionManager } = await loadPi();
  rmSync(disk.file);

  // The file the store's index named is gone by the time the read happens.
  // Opening a path that is not there is a fresh session to pi rather than a
  // failed read, so a find that opened it would answer an id of its own
  // invention as this session's row - and write the file back out.
  const lookup = vi.spyOn(SessionManager, 'findById').mockReturnValue(disk.file);
  try {
    expect(await piAgent({ sessionDir }, [root]).find?.(disk.id)).toBeUndefined();
  }
  finally { lookup.mockRestore(); }
  expect(existsSync(disk.file)).toBe(false);
});

/** A session file pi wrote before its current format: no parent ids, version 1. */
const older = (id: string, cwd: string): string => `${[
  JSON.stringify({ type: 'session', version: 1, id, timestamp: '2026-01-01T00:00:00.000Z', cwd }),
  JSON.stringify({
    type: 'message',
    id: 'e1',
    timestamp: '2026-01-01T00:00:00.000Z',
    message: { role: 'user', content: 'a session from an older pi', timestamp: Date.parse('2026-01-01T00:00:00.000Z') },
  }),
].join('\n')}\n`;

it('reads an older-format session file without migrating it', async () => {
  const sessionDir = join(root, 'old');
  mkdirSync(sessionDir, { recursive: true });
  const file = join(sessionDir, 'old-1.jsonl');
  const written = older('old-1', root);
  writeFileSync(file, written);
  const agent = piAgent({ sessionDir }, [root]);

  // Opening the file would migrate it to the current version and write it back
  // - a find that changes a session in order to answer a question about it.
  expect(await agent.find?.('old-1')).toEqual((await agent.list?.())?.find((one) => one.id === 'old-1'));
  expect((await agent.find?.('old-1'))?.title).toBe('a session from an older pi');
  expect(readFileSync(file, 'utf8')).toBe(written);
});

it('answers nothing when the file it was named does not hold that session', async () => {
  const sessionDir = join(root, 'pi');
  const disk = await sessionOnDisk(sessionDir);
  const { SessionManager } = await loadPi();

  // The header is what says whose session a file is, and pi's own lookup
  // matched it a moment ago. A file that changed under that lookup is a read
  // that found nothing rather than one that found somebody else's row.
  const other = await sessionOnDisk(join(root, 'elsewhere'), 'a title');
  const lookup = vi.spyOn(SessionManager, 'findById').mockReturnValue(other.file);
  try {
    expect(await piAgent({ sessionDir }, [root]).find?.(disk.id)).toBeUndefined();
  }
  finally { lookup.mockRestore(); }
});

it('never lists a project folder to answer one id', async () => {
  const sessionDir = join(root, 'pi');
  const disk = await sessionOnDisk(sessionDir);
  const { SessionManager } = await loadPi();
  const listing = vi.spyOn(SessionManager, 'list');
  let answered;
  try {
    answered = await piAgent({ sessionDir }, [root]).find?.(disk.id);
  }
  finally { listing.mockRestore(); }
  expect(answered?.id).toBe(disk.id);
  expect(listing).not.toHaveBeenCalled();
});
