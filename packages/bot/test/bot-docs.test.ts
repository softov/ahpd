import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { parseYaml, stringifyYaml } from '@cofold/yaml';
import { readRecordFile } from '../../server/src/records.js';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { readAgents } from '../src/agents.js';
import { botStore } from '../src/store.js';

/*
 * The files `docs/plugins/BOTS.md` shows, read the way the daemon reads them.
 *
 * The page prints a record and an `AGENTS.md` a person may copy, so both are
 * files the daemon has to accept: the record has every field a bot needs and no
 * persona, and the `AGENTS.md` has the parts its owner edits. A change on either
 * side the other did not follow is a doc that has stopped being true.
 */

const PAGE = join(import.meta.dirname, '../../../docs/plugins/BOTS.md');

/** The parser the daemon hands a plugin, and the one the other plugin tests use. */
const yaml = { parseYaml, stringifyYaml };

/**
 * The page's level-2 sections, by heading.
 *
 * A fenced block may hold a `## ` line of its own - the `AGENTS.md` sample has
 * two - so a heading counts only outside a fence.
 */
const sections = (markdown: string): Map<string, string> => {
  const found = new Map<string, string>();
  let heading: string | undefined;
  let body: string[] = [];
  let fenced = false;
  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    const at = fenced ? null : /^## (.+)$/.exec(line);
    if (at !== null) {
      if (heading !== undefined) found.set(heading, body.join('\n'));
      heading = at[1] ?? '';
      body = [];
      continue;
    }
    body.push(line);
  }
  if (heading !== undefined) found.set(heading, body.join('\n'));
  return found;
};

/** The one fenced block a section of the page shows, as the text between its fences. */
const sample = (markdown: string, heading: string): string => {
  const body = sections(markdown).get(heading);
  if (body === undefined) throw new Error(`docs/plugins/BOTS.md has no ${heading} section`);
  const opened = /^```md\n([\s\S]*?)^```$/m.exec(body);
  if (opened === null) throw new Error(`the ${heading} section of docs/plugins/BOTS.md shows no file`);
  return opened[1] ?? '';
};

it('shows a record the daemon reads as a bot without the persona', async () => {
  const record = readRecordFile(sample(readFileSync(PAGE, 'utf8'), 'The record file'), 'instructions');
  expect(record['id']).toBe('motion');
  // The persona is the `AGENTS.md`'s: a record that carried it would be a
  // second copy, out of step the first time the bot rewrote its own file.
  expect(record['name']).toBeUndefined();
  expect(record['description']).toBeUndefined();
  expect(record['instructions'] ?? '').toBe('');

  /*
   * Read into a store, which is the check every record from a collection
   * passes: a field that is missing or of the wrong type is a problem line
   * rather than a bot, and the file the page prints has to be neither.
   */
  const problems: string[] = [];
  const records = memoryRecords();
  await (await records.collection('bots', { body: 'instructions' })).put(record);
  const store = botStore(
    await records.collection('bots', { body: 'instructions' }),
    await records.collection('bots-gone'),
    (line) => problems.push(line),
  );
  await store.ready();

  expect(problems).toEqual([]);
  // The name falls back to the slug, and a file with no Instructions section
  // is a bot with no instructions rather than one with an empty sentence.
  expect(store.get('motion')).toMatchObject({ name: 'motion', color: 'teal', body: 'robot' });
  expect(store.get('motion')?.instructions).toBeUndefined();
});

it('shows an AGENTS.md whose parts the UI owns', () => {
  const parts = readAgents(yaml, sample(readFileSync(PAGE, 'utf8'), 'The persona'));
  expect(parts.name).toBe('Motion');
  expect(parts.description).toBe('Reads pull requests and says what would break.');
  expect(parts.instructions).toMatch(/^You review pull requests\./);
});
