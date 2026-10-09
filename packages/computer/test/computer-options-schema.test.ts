import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { closeAll, keeping } from './support/closing.js';
import { optionsSchema, profilesOf } from '../src/plugin.js';

/*
 * The profile schema a client reads, against the fields a profile holds.
 *
 * Every field `profilesOf` keeps is a property of a profile, so a client that
 * reads the schema sees each one. A field with no type is read by
 * `profilesOf` alone, so a value of the wrong type costs that setting and the
 * load goes on.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/computer/src/index.ts';
const NAME = 'ahpd-computer';

/** A profile that writes every field `profilesOf` reads, each with a value it keeps. */
const EVERY_FIELD: Record<string, unknown> = {
  title: 'Bots',
  description: 'Where the bots run.',
  image: 'debian:bookworm-slim',
  cpus: '2',
  memory: '4g',
  workdir: '/work',
  mounts: ['/srv:/srv:ro'],
  agents: ['claude'],
  parts: ['node'],
  needs: { ANTHROPIC_API_KEY: 'k' },
  folder: '/srv/app',
  host: ['ahpd'],
  disposable: true,
  disposableDelay: 1000,
  disposableAlone: true,
  sessionFolder: true,
  sessionRepository: true,
  sessionTree: 'copy',
  secretUnreadable: 'drop',
  state: 'host',
  stateScope: 'shared',
  gitGuard: 'open',
  nestedDelete: 'record',
};

/** The properties a profile declares. */
const profileProperties = (): Record<string, Record<string, unknown>> =>
  (optionsSchema.properties.profiles.additionalProperties.properties as Record<string, Record<string, unknown>>);

let home: string | undefined;
afterEach(async () => {
  await closeAll();
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
  home = undefined;
});

const load = async (options: Record<string, unknown>) => {
  home ??= mkdtempSync(join(tmpdir(), 'ahpd-computer-options-schema-'));
  const result = await loadPlugins([{ name: SOURCE, options }], {
    base: { path: '/tmp/computer-options-schema', agents: [echo({ path: '/tmp/computer-options-schema' })] },
    configDir: home,
    cwd: REPO,
    log: () => {},
  });
  keeping(result.options);
  return result;
};

it('declares every field profilesOf keeps as a property of the profile schema', () => {
  const kept = profilesOf({ bots: EVERY_FIELD })?.bots ?? {};
  expect(Object.keys(kept).sort()).toEqual(Object.keys(EVERY_FIELD).sort());
  const properties = profileProperties();
  for (const field of Object.keys(kept)) expect(properties, field).toHaveProperty(field);
});

it('loads a profile with cpus: 2, and the profile keeps no cpus', async () => {
  const loaded = await load({ profiles: { small: { cpus: 2 } } });
  expect(loaded.problems).toEqual([]);
  expect(loaded.loaded.map((one) => one.name)).toEqual([NAME]);
  expect(profilesOf({ small: { cpus: 2 } })?.small).not.toHaveProperty('cpus');
});
