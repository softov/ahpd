import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadPlugins } from '../../server/src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import { DECLARED } from '../src/options.js';
import { optionsSchema } from '../src/plugin.js';

/*
 * The preset schema a client reads, against the options a preset holds.
 *
 * Every declared option is a property of a preset, so a client that reads the
 * schema sees each one. A property names no type, so a value of the wrong
 * type is refused by the preset check and costs that preset, not the load.
 */

const REPO = join(import.meta.dirname, '../../..');
const NAME = '@ahpd/agent-claude';
const SOURCE = './packages/agent-claude/src/index.ts';

/** The properties a preset declares. */
const presetProperties = (): Record<string, Record<string, unknown>> =>
  (optionsSchema.properties.presets.additionalProperties.properties as Record<string, Record<string, unknown>>);

/** The plugin's own load, and what it said. */
const load = async (options: Record<string, unknown>) => {
  const { loaded, problems, options: served } = await loadPlugins([{ name: SOURCE, options }], {
    base: { path: '/tmp/ahpd-preset', agents: [echo({ path: '/tmp/ahpd-preset' })] },
    configDir: REPO,
    cwd: REPO,
    log: () => {},
  });
  return { loaded, problems, served };
};

it('declares every option a preset holds as a property of the preset schema', () => {
  const properties = presetProperties();
  for (const name of Object.keys(DECLARED)) {
    expect(properties, name).toHaveProperty(name);
    expect(typeof properties[name]?.description, name).toBe('string');
  }
});

it('leaves out a preset with thinking: 5 and registers the built-in', async () => {
  const { loaded, problems, served } = await load({ presets: { work: { thinking: 5 } } });
  expect(loaded.map((one) => one.name)).toEqual([NAME]);
  expect((served.agents ?? []).slice(1).map((one) => one.provider)).toEqual(['claude']);
  const skipped = problems.filter((line) => line.startsWith(`${NAME}: `));
  expect(skipped).toHaveLength(1);
  expect(skipped[0]).toMatch(/options\.presets\.work\.thinking is not one of adaptive, disabled$/u);
  expect(problems.filter((line) => !line.startsWith(`${NAME}: `))).toEqual([]);
});
