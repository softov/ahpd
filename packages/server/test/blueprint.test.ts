/*
 * VS Code's `.automation.md` file, read and written here, ahpd's own file, and
 * `ahpd automation list`, `export` and `import` on both surfaces.
 *
 * The format is VS Code's own, so what is pinned is that a file VS Code wrote
 * reads back to the same text, that each schedule the format holds is written
 * and read again unchanged, and that an automation the format cannot hold is
 * refused with a sentence naming what, rather than written as something it is
 * not. ahpd's own file carries every trigger, zone and setting through a
 * round trip. An import is a new automation, switched off, in a folder this
 * host serves.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { manifestFrom } from '@cofold/remote';
import { parseYaml } from '@cofold/yaml';
import { memoryAutomations } from '@ahpd/sdk';
import type { AutomationEntry, AutomationStore, Bag } from '@ahpd/sdk';
import {
  AutomationBlueprintParseError,
  automationToBlueprint,
  createAutomationBlueprintFileName,
  parseAutomationBlueprint,
  scheduleTrigger,
  serializeAutomationBlueprint,
} from '../src/blueprint.js';
import { automationStatePath, automationsDir } from '../src/config.js';
import { optionsFrom } from '../src/commands/options.js';
import { cliRegistry } from '../src/commands/registry.js';
import { apiOrigins } from '../src/commands/run.js';
import { servedRegistry, type ServedFacts } from '../src/commands/served.js';
import { apiHandler } from '../src/http.js';
import { scheduledAutomations } from '../src/scheduled.js';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'review-yesterday-s-commits.automation.md');
const ZONE = 'America/Campo_Grande';
const AUTHORITY = '127.0.0.1:9361';

/** One automation as the store holds it, with the triggers given. */
const entry = (triggers: Bag[], title = 'Review yesterday\'s commits', text = 'Review the commits.'): AutomationEntry => ({
  resource: 'ahp-automation:/0b6f1c1e-4d8e-4d8a-9a43-6a3f4c2b9e10',
  definition: {
    title,
    message: { text, origin: { kind: 'automation' } },
    session: { provider: 'claude', workingDirectories: ['file:///home/softov/ahpd'] },
    enabled: true,
    triggers,
  },
  runs: [],
  operations: ['update', 'remove', 'run'],
  createdAt: '2026-10-15T00:00:00.000Z',
  modifiedAt: '2026-10-15T00:00:00.000Z',
});

/** One schedule trigger, as VS Code's agent host writes one. */
const schedule = (expression: string, timeZone: string | null = ZONE, misfirePolicy = 'runOnce'): Bag => ({
  id: 'schedule',
  kind: 'schedule',
  schedule: { expression, ...(timeZone === null ? {} : { timeZone }) },
  misfirePolicy,
});

/** The refusal an export makes, as its sentence. */
const refusal = (automation: AutomationEntry): string => {
  try {
    automationToBlueprint(automation);
  }
  catch (error) {
    return (error as Error).message;
  }
  throw new Error('exported');
};

/** The frontmatter of a file, as YAML reads it. */
const header = (text: string): Bag => parseYaml(text.split('---\n')[1] ?? '') as Bag;

describe('the file VS Code wrote', () => {
  const text = readFileSync(FIXTURE, 'utf8');

  it('parses to its name, prompt and schedule', () => {
    const blueprint = parseAutomationBlueprint(text);
    expect(blueprint).toMatchObject({
      version: 1,
      id: 'review-yesterday-s-commits',
      name: 'Review yesterday\'s commits',
      schedule: { interval: 'daily', scheduleHour: 9, scheduleMinute: 0 },
    });
    expect(blueprint.prompt.startsWith('Review the commits made to this repository since yesterday morning.\n1. Fetch')).toBe(true);
    expect(blueprint.prompt.endsWith('say so in one line.')).toBe(true);
  });

  it('serializes back to the same text', () => {
    expect(serializeAutomationBlueprint(parseAutomationBlueprint(text))).toBe(text);
  });
});

describe('export', () => {
  const cases: [string, string, Bag][] = [
    ['daily', '30 9 * * *', { interval: 'daily', scheduleHour: 9, scheduleMinute: 30 }],
    ['weekdays', '0 8 * * 1-5', { interval: 'weekdays', scheduleHour: 8, scheduleMinute: 0 }],
    ['weekly', '15 17 * * 5', { interval: 'weekly', scheduleHour: 17, scheduleMinute: 15, scheduleDay: 5 }],
    ['hourly', '0 * * * *', { interval: 'hourly' }],
  ];
  for (const [name, expression, expected] of cases) {
    it(`writes a ${name} schedule that reads back the same`, () => {
      const blueprint = automationToBlueprint(entry([schedule(expression)]));
      expect(blueprint.schedule).toMatchObject(expected);
      const text = serializeAutomationBlueprint(blueprint);
      expect(parseAutomationBlueprint(text)).toEqual(blueprint);
    });
  }

  it('writes a daily schedule as VS Code does', () => {
    const text = serializeAutomationBlueprint(automationToBlueprint(entry([schedule('0 9 * * *')])));
    expect(text).toBe([
      '---',
      'version: 1',
      'id: "review-yesterday-s-commits"',
      'name: "Review yesterday\'s commits"',
      'schedule:',
      '  kind: cron',
      '  expression: "0 9 * * *"',
      '  timeZone: local',
      '---',
      '',
      'Review the commits.',
      '',
    ].join('\n'));
  });

  it('writes an automation with no schedule as manual', () => {
    const blueprint = automationToBlueprint(entry([]));
    expect(blueprint.schedule.interval).toBe('manual');
    const text = serializeAutomationBlueprint(blueprint);
    expect(header(text)['schedule']).toEqual({ kind: 'manual' });
    expect(parseAutomationBlueprint(text)).toEqual(blueprint);
  });

  it('reads the weekday spellings a cron allows, and 7 as Sunday', () => {
    expect(automationToBlueprint(entry([schedule('0 8 * * MON-FRI')])).schedule.interval).toBe('weekdays');
    expect(automationToBlueprint(entry([schedule('0 8 * * 1,2,3,4,5')])).schedule.interval).toBe('weekdays');
    expect(automationToBlueprint(entry([schedule('0 8 * * 7')])).schedule.scheduleDay).toBe(0);
  });

  it('writes no key but the five the format allows', () => {
    for (const triggers of [[], [schedule('0 * * * *')], [schedule('0 9 * * 1-5')]]) {
      const keys = Object.keys(header(serializeAutomationBlueprint(automationToBlueprint(entry(triggers)))));
      expect(keys.every((key) => ['version', 'id', 'name', 'description', 'schedule'].includes(key))).toBe(true);
    }
  });

  it('names the file after the automation, as VS Code does', () => {
    expect(createAutomationBlueprintFileName('Review yesterday\'s commits')).toBe('review-yesterday-s-commits.automation.md');
    expect(createAutomationBlueprintFileName('Café --- résumé')).toBe('cafe-resume.automation.md');
    expect(createAutomationBlueprintFileName('!!!')).toBe('automation.automation.md');
  });

  it('refuses a webhook or event trigger', () => {
    const event = { id: 't1', kind: 'event', type: 'webhook', title: 'On a call', events: [{ id: 'call' }], config: {} };
    expect(refusal(entry([event]))).toBe('0b6f1c1e-4d8e-4d8a-9a43-6a3f4c2b9e10 has an event trigger, and a VS Code automation file holds only a schedule.');
  });

  it('refuses two schedules', () => {
    expect(refusal(entry([schedule('0 9 * * *'), { ...schedule('0 17 * * *'), id: 'evening' }])))
      .toBe('0b6f1c1e-4d8e-4d8a-9a43-6a3f4c2b9e10 has more than one schedule, and a VS Code automation file holds one.');
  });

  it('writes any other cron as a cron schedule with its expression, as VS Code does', () => {
    for (const expression of ['*/5 * * * *', '0 9 1 * *', '0 9 * * 1,3']) {
      const text = serializeAutomationBlueprint(automationToBlueprint(entry([schedule(expression)])));
      expect(header(text)['schedule']).toEqual({ kind: 'cron', expression, timeZone: 'local' });
    }
    // A weekday by name is the weekly time it is.
    expect(automationToBlueprint(entry([schedule('0 9 * * MON')])).schedule).toMatchObject({ interval: 'weekly', scheduleDay: 1 });
  });

  it('writes an hourly schedule at any minute as hourly, as VS Code does', () => {
    const text = serializeAutomationBlueprint(automationToBlueprint(entry([schedule('30 * * * *')])));
    expect(header(text)['schedule']).toEqual({ kind: 'hourly' });
  });

  it('writes local for another zone, and keeps the hour', () => {
    const text = serializeAutomationBlueprint(automationToBlueprint(entry([schedule('30 9 * * *', 'Europe/Lisbon')])));
    expect(header(text)['schedule']).toEqual({ kind: 'cron', expression: '30 9 * * *', timeZone: 'local' });
    expect(automationToBlueprint(entry([schedule('0 9 * * *', null)])).schedule).toMatchObject({ interval: 'daily', scheduleHour: 9 });
  });

  it('refuses a schedule that skips a missed run', () => {
    expect(refusal(entry([schedule('0 9 * * *', ZONE, 'skip')])))
      .toBe('0b6f1c1e-4d8e-4d8a-9a43-6a3f4c2b9e10 skips a missed run, and a VS Code automation file always catches one up.');
  });

  it('refuses an automation with no message', () => {
    expect(refusal(entry([], 'Empty', '  '))).toBe('0b6f1c1e-4d8e-4d8a-9a43-6a3f4c2b9e10 has no message, and a VS Code automation file needs one.');
  });
});

describe('parse', () => {
  const file = (lines: string[], body = 'Do it.'): string => ['---', ...lines, '---', '', body, ''].join('\n');
  const code = (text: string): string | undefined => {
    try {
      parseAutomationBlueprint(text);
    }
    catch (error) {
      return error instanceof AutomationBlueprintParseError ? `${error.code}: ${error.message}` : String(error);
    }
    return undefined;
  };
  const base = ['version: 1', 'id: "a"', 'name: "A"'];

  it('refuses what VS Code refuses, with its sentence', () => {
    expect(code('no frontmatter')).toBe('invalidFrontmatter: The file must start with valid YAML frontmatter.');
    expect(code(file([...base, 'schedule:', '  kind: manual', 'owner: "me"']))).toBe('unknownProperty: The property \'owner\' is not supported.');
    expect(code(file([...base, 'schedule:', '  kind: hourly', '  minute: 5']))).toBe('unknownProperty: The property \'schedule.minute\' is not supported.');
    expect(code(file(['version: 2', 'id: "a"', 'name: "A"', 'schedule:', '  kind: manual']))).toBe('unsupportedVersion: Automation blueprint version 2 is not supported.');
    expect(code(file(['version: 1', 'id: "A--b"', 'name: "A"', 'schedule:', '  kind: manual']))).toBe('invalidId: The blueprint id \'A--b\' is invalid.');
    expect(code(file(['version: 1', 'id: "a"', 'schedule:', '  kind: manual']))).toBe('invalidField: The property \'name\' is missing or invalid.');
    expect(code(file([...base, 'schedule:', '  kind: cron', '  expression: "*/5 * * *"', '  timeZone: local'])))
      .toBe('unsupportedSchedule: The cron expression \'*/5 * * *\' cannot be represented by the current Automation editor.');
    expect(code(file([...base, 'schedule:', '  kind: cron', '  expression: "0 9 * * *"', '  timeZone: "UTC"'])))
      .toBe('unsupportedTimeZone: The time zone \'UTC\' is not supported. Use \'local\' so the schedule follows the importing user\'s time zone.');
    expect(code(file([...base, 'schedule:', '  kind: manual'], '  '))).toBe('missingPrompt: The Automation prompt must follow the frontmatter.');
  });

  it('keeps a description', () => {
    expect(parseAutomationBlueprint(file([...base, 'description: "Why"', 'schedule:', '  kind: manual'])).description).toBe('Why');
  });

  it('reads any five-field cron as a cron schedule, which becomes its trigger as it is', () => {
    const read = parseAutomationBlueprint(file([...base, 'schedule:', '  kind: cron', '  expression: "*/5 9-17 * * 1-5"', '  timeZone: local']));
    expect(read.schedule).toEqual({ interval: 'cron', cronExpression: '*/5 9-17 * * 1-5', scheduleHour: 0, scheduleMinute: 0, scheduleDay: 0 });
    expect(scheduleTrigger(read.schedule, 'Europe/Lisbon')).toEqual([{
      id: 'schedule', kind: 'schedule', schedule: { expression: '*/5 9-17 * * 1-5', timeZone: 'Europe/Lisbon' }, misfirePolicy: 'runOnce',
    }]);
  });
});

describe('ahpd automation export', () => {
  let home: string;
  let had: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ahpd-automation-export-'));
    had = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = home;
  });
  afterEach(() => {
    if (had === undefined) delete process.env['XDG_CONFIG_HOME'];
    else process.env['XDG_CONFIG_HOME'] = had;
    rmSync(home, { recursive: true, force: true });
  });

  const ID = '0b6f1c1e-4d8e-4d8a-9a43-6a3f4c2b9e10';
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  /** The daemon's folder, holding one daily automation in this host's zone. */
  const kept = (triggers: Bag[] = [schedule('0 9 * * *', zone)]): void => {
    const store = scheduledAutomations({ dir: automationsDir(), state: automationStatePath(), timer: () => ({ cancel: () => {} }) });
    store.create(`ahp-automation:/${ID}`, entry(triggers).definition);
    store.close?.();
  };

  const run = async (input: Record<string, unknown>): Promise<{ data: unknown; text: string }> => {
    const registry = cliRegistry();
    const command = registry.find('automation.export');
    if (command === undefined) throw new Error('no automation.export');
    const said = await registry.execute(command, { surface: 'cli', input, readStdin: async () => '' });
    if (said === null) throw new Error('answered nothing');
    return { data: said.data, text: typeof said.plain === 'function' ? said.plain() : said.plain ?? '' };
  };

  it('prints VS Code\'s file at a terminal with --vscode', async () => {
    kept();
    const said = await run({ id: ID, vscode: true });
    const text = (said.data as { text: string }).text;
    expect(said.data).toMatchObject({ id: ID, fileName: 'review-yesterday-s-commits.automation.md' });
    expect(parseAutomationBlueprint(text).schedule).toMatchObject({ interval: 'daily', scheduleHour: 9 });
    expect(said.text).toBe(text);
  });

  it('writes the file with --out', async () => {
    kept();
    const out = join(home, 'out.automation.md');
    const said = await run({ id: `ahp-automation:/${ID}`, out, vscode: true });
    expect(said.text).toBe(`Wrote ${out}.\n`);
    expect(readFileSync(out, 'utf8')).toBe((said.data as { text: string }).text);
  });

  it('refuses with --vscode an automation VS Code\'s file cannot hold, and writes nothing', async () => {
    // Two schedules, where VS Code's file holds one.
    kept([schedule('0 9 * * 1-5', zone), schedule('0 18 * * 1-5', zone)]);
    const out = join(home, 'out.automation.md');
    await expect(run({ id: ID, out, vscode: true })).rejects.toThrow('has more than one schedule, and a VS Code automation file holds one.');
    expect(existsSync(out)).toBe(false);
  });

  it('refuses an id the store does not hold', async () => {
    await expect(run({ id: 'nothing' })).rejects.toThrow('No automation called nothing.');
  });

  describe('served', () => {
    let store: AutomationStore;
    beforeEach(() => {
      store = memoryAutomations();
      store.create(`ahp-automation:/${ID}`, entry([schedule('0 9 * * 1-5', zone)]).definition);
    });

    const facts = (): ServedFacts => ({
      options: optionsFrom({}),
      configFile: join(home, 'config.json'),
      running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9361, paths: [], startedAt: '' }),
      turning: () => [],
      automations: () => store,
      restart: () => {},
    });

    const call = async (path: string): Promise<Response> => {
      const handler = apiHandler({
        registry: servedRegistry(facts()),
        token: 'root-secret',
        program: { name: 'ahpd', version: '0.0.0' },
        origins: () => apiOrigins('127.0.0.1', undefined, 9361),
      });
      return handler(new Request(`http://${AUTHORITY}/api${path}`, {
        headers: { host: AUTHORITY, authorization: 'Bearer root-secret' },
      }));
    };

    it('answers VS Code\'s file over /api', async () => {
      const answer = await call(`/automation/export/${ID}?vscode=true`);
      expect(answer.status).toBe(200);
      const body = await answer.json() as { id: string; fileName: string; text: string };
      expect(body.fileName).toBe('review-yesterday-s-commits.automation.md');
      expect(parseAutomationBlueprint(body.text).schedule.interval).toBe('weekdays');
    });

    it('refuses one it cannot hold as a conflict', async () => {
      store.create('ahp-automation:/other', entry([schedule('0 9 * * 1-5', zone), schedule('0 18 * * 1-5', zone)]).definition);
      const answer = await call('/automation/export/other?vscode=true');
      expect(answer.status).toBe(409);
      expect((await answer.json() as { message: string }).message).toContain('has more than one schedule');
    });
  });
});

describe('ahpd automation list', () => {
  let home: string;
  let had: string | undefined;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ahpd-automation-list-'));
    had = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = home;
  });
  afterEach(() => {
    if (had === undefined) delete process.env['XDG_CONFIG_HOME'];
    else process.env['XDG_CONFIG_HOME'] = had;
    rmSync(home, { recursive: true, force: true });
  });

  const ID = '0b6f1c1e-4d8e-4d8a-9a43-6a3f4c2b9e10';
  const rows = [
    { id: ID, name: 'Review yesterday\'s commits', folder: '/home/softov/ahpd', schedule: `0 9 * * * ${ZONE}`, enabled: true },
    { id: 'quiet', name: 'quiet', schedule: 'manual', enabled: false },
  ];

  /** Two automations: one daily in a folder, and one manual, untitled and switched off. */
  const fill = (store: AutomationStore): void => {
    store.create(`ahp-automation:/${ID}`, entry([schedule('0 9 * * *')]).definition);
    store.create('ahp-automation:/quiet', { message: { text: 'Hush.' }, enabled: false, triggers: [] });
  };

  const run = async (): Promise<{ data: unknown; text: string }> => {
    const registry = cliRegistry();
    const command = registry.find('automation.list');
    if (command === undefined) throw new Error('no automation.list');
    const said = await registry.execute(command, { surface: 'cli', input: {}, readStdin: async () => '' });
    if (said === null) throw new Error('answered nothing');
    return { data: said.data, text: typeof said.plain === 'function' ? said.plain() : said.plain ?? '' };
  };

  it('shows each automation at a terminal, and the same rows as data', async () => {
    const store = scheduledAutomations({ dir: automationsDir(), state: automationStatePath(), timer: () => ({ cancel: () => {} }) });
    fill(store);
    store.close?.();
    const said = await run();
    expect(said.data).toEqual(expect.arrayContaining(rows));
    expect((said.data as unknown[]).length).toBe(2);
    expect(said.text.split('\n')).toEqual(expect.arrayContaining([
      `${ID}  Review yesterday's commits  /home/softov/ahpd  0 9 * * * ${ZONE}  on`,
      'quiet  quiet  -  manual  off',
    ]));
  });

  it('says so when there is none', async () => {
    const said = await run();
    expect(said.data).toEqual([]);
    expect(said.text).toBe('No automations yet.\n');
  });

  it('answers the same rows over /api', async () => {
    const store = memoryAutomations();
    fill(store);
    const facts: ServedFacts = {
      options: optionsFrom({}),
      configFile: join(home, 'config.json'),
      running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9361, paths: [], startedAt: '' }),
      turning: () => [],
      automations: () => store,
      restart: () => {},
    };
    const handler = apiHandler({
      registry: servedRegistry(facts),
      token: 'root-secret',
      program: { name: 'ahpd', version: '0.0.0' },
      origins: () => apiOrigins('127.0.0.1', undefined, 9361),
    });
    const answer = await handler(new Request(`http://${AUTHORITY}/api/automation/list`, {
      headers: { host: AUTHORITY, authorization: 'Bearer root-secret' },
    }));
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual(rows);
  });
});

describe('ahpd automation import', () => {
  let home: string;
  let had: string | undefined;
  let work: string;
  let config: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ahpd-automation-import-'));
    had = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = home;
    work = join(home, 'work');
    mkdirSync(join(work, 'ahpd'), { recursive: true });
    config = join(home, 'config.json');
    writeFileSync(config, `${JSON.stringify({ paths: [work] })}\n`);
  });
  afterEach(() => {
    if (had === undefined) delete process.env['XDG_CONFIG_HOME'];
    else process.env['XDG_CONFIG_HOME'] = had;
    rmSync(home, { recursive: true, force: true });
  });

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const run = async (input: Record<string, unknown>): Promise<{ data: { id: string; resource: string }; text: string }> => {
    const registry = cliRegistry();
    const command = registry.find('automation.import');
    if (command === undefined) throw new Error('no automation.import');
    const said = await registry.execute(command, { surface: 'cli', input: { configFile: config, vscode: true, ...input }, readStdin: async () => '' });
    if (said === null) throw new Error('answered nothing');
    return { data: said.data as { id: string; resource: string }, text: typeof said.plain === 'function' ? said.plain() : said.plain ?? '' };
  };

  /** Every automation the daemon's folder holds now. */
  const held = (): AutomationEntry[] => {
    const store = scheduledAutomations({ dir: automationsDir(), state: automationStatePath(), timer: () => ({ cancel: () => {} }) });
    const all = store.list();
    store.close?.();
    return all;
  };

  /** A file of VS Code's with these frontmatter lines. */
  const file = (lines: string[]): string => {
    const at = join(home, 'one.automation.md');
    writeFileSync(at, ['---', ...lines, '---', '', 'Do it.', ''].join('\n'));
    return at;
  };

  it('makes the fixture a switched-off automation in the folder given', async () => {
    const folder = join(work, 'ahpd');
    const said = await run({ file: FIXTURE, folder });
    expect(said.data.resource).toBe(`ahp-automation:/${said.data.id}`);
    expect(said.text).toBe(`Imported Review yesterday's commits as ${said.data.id}. It is switched off.\n`);
    const [one] = held();
    expect(one?.resource).toBe(said.data.resource);
    const definition = one?.definition as Bag;
    const fixture = parseAutomationBlueprint(readFileSync(FIXTURE, 'utf8'));
    expect(definition).toMatchObject({
      title: 'Review yesterday\'s commits',
      message: { text: fixture.prompt, origin: { kind: 'automation' } },
      session: { workingDirectories: [pathToFileURL(folder).href] },
      enabled: false,
      triggers: [{ id: 'schedule', kind: 'schedule', schedule: { expression: '0 9 * * *', timeZone: zone }, misfirePolicy: 'runOnce' }],
    });
    expect((definition['session'] as Bag)['provider']).toBeUndefined();
  });

  it('makes a second automation with another id from the same file', async () => {
    const first = await run({ file: FIXTURE, folder: work });
    const second = await run({ file: FIXTURE, folder: work });
    expect(second.data.id).not.toBe(first.data.id);
    expect(held().map((one) => one.resource).sort()).toEqual([first.data.resource, second.data.resource].sort());
  });

  it('reads a manual and an hourly file as the triggers VS Code writes', async () => {
    const manual = await run({ file: file(['version: 1', 'id: "m"', 'name: "M"', 'schedule:', '  kind: manual']), folder: work });
    const hourly = await run({ file: file(['version: 1', 'id: "h"', 'name: "H"', 'schedule:', '  kind: hourly']), folder: work });
    const by = new Map(held().map((one) => [one.resource, one.definition]));
    expect(by.get(manual.data.resource)?.['triggers']).toEqual([]);
    expect(by.get(hourly.data.resource)?.['triggers']).toEqual([
      { id: 'schedule', kind: 'schedule', schedule: { expression: '0 * * * *', timeZone: zone }, misfirePolicy: 'runOnce' },
    ]);
  });

  it('exports back to the file it was imported from', async () => {
    const said = await run({ file: FIXTURE, folder: work });
    const exported = cliRegistry();
    const command = exported.find('automation.export');
    if (command === undefined) throw new Error('no automation.export');
    const answer = await exported.execute(command, { surface: 'cli', input: { id: said.data.id, vscode: true }, readStdin: async () => '' });
    expect((answer?.data as { text: string }).text).toBe(readFileSync(FIXTURE, 'utf8'));
  });

  it('refuses no --folder', async () => {
    await expect(run({ file: FIXTURE })).rejects.toThrow('automation import needs --folder: the file names no folder to run in.');
    expect(held()).toEqual([]);
  });

  it('refuses a folder this host does not serve', async () => {
    const outside = join(home, 'elsewhere');
    mkdirSync(outside);
    await expect(run({ file: FIXTURE, folder: outside })).rejects.toThrow(`${outside} is not a folder this host serves. Add it with ahpd paths add.`);
    expect(held()).toEqual([]);
  });

  it('refuses an unknown version and an unknown key, with VS Code\'s sentence', async () => {
    const two = file(['version: 2', 'id: "a"', 'name: "A"', 'schedule:', '  kind: manual']);
    await expect(run({ file: two, folder: work })).rejects.toThrow(`${two}: Automation blueprint version 2 is not supported.`);
    const keyed = file(['version: 1', 'id: "a"', 'name: "A"', 'enabled: true', 'schedule:', '  kind: manual']);
    await expect(run({ file: keyed, folder: work })).rejects.toThrow(`${keyed}: The property 'enabled' is not supported.`);
    expect(held()).toEqual([]);
  });

  describe('served', () => {
    let store: AutomationStore;
    beforeEach(() => { store = memoryAutomations(); });

    const facts = (): ServedFacts => ({
      options: optionsFrom({ configFile: config }),
      configFile: config,
      running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9361, paths: [work], startedAt: '' }),
      turning: () => [],
      automations: () => store,
      restart: () => {},
    });

    const call = async (body: unknown): Promise<Response> => {
      const handler = apiHandler({
        registry: servedRegistry(facts()),
        token: 'root-secret',
        program: { name: 'ahpd', version: '0.0.0' },
        origins: () => apiOrigins('127.0.0.1', undefined, 9361),
      });
      return handler(new Request(`http://${AUTHORITY}/api/automation/import`, {
        method: 'POST',
        headers: { host: AUTHORITY, 'content-type': 'application/json', authorization: 'Bearer root-secret' },
        body: JSON.stringify(body),
      }));
    };

    it('reads the file from the body', async () => {
      const answer = await call({ text: readFileSync(FIXTURE, 'utf8'), folder: work, vscode: true });
      expect(answer.status).toBe(200);
      const body = await answer.json() as { id: string; resource: string };
      const kept = store.get(body.resource);
      expect(kept?.definition).toMatchObject({ title: 'Review yesterday\'s commits', enabled: false });
    });

    it('takes no path', async () => {
      const command = manifestFrom(servedRegistry(facts()), { name: 'ahpd', version: '0.0.0' }).commands.find((one) => one.id === 'automation.import');
      expect([...(command?.options ?? []).map((one) => one.field ?? one.name), ...Object.keys(command?.arguments ?? {})].sort()).toEqual(['folder', 'text', 'vscode']);
      const answer = await call({ file: FIXTURE, folder: work, vscode: true });
      expect(answer.status).toBe(400);
      expect(store.list()).toEqual([]);
    });

    it('refuses a folder that is not absolute', async () => {
      const answer = await call({ text: readFileSync(FIXTURE, 'utf8'), folder: 'work', vscode: true });
      expect(answer.status).toBe(400);
      expect((await answer.json() as { message: string }).message).toBe('work is not an absolute path.');
    });
  });
});

describe('ahpd\'s own automation file', () => {
  let home: string;
  let had: string | undefined;
  let work: string;
  let config: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'ahpd-automation-native-'));
    had = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = home;
    work = join(home, 'work');
    mkdirSync(join(work, 'ahpd'), { recursive: true });
    config = join(home, 'config.json');
    writeFileSync(config, `${JSON.stringify({ paths: [work] })}\n`);
  });
  afterEach(() => {
    if (had === undefined) delete process.env['XDG_CONFIG_HOME'];
    else process.env['XDG_CONFIG_HOME'] = had;
    rmSync(home, { recursive: true, force: true });
  });

  const ID = 'nightly-review';
  const EVENT: Bag = { id: 't1', kind: 'event', type: 'webhook', title: 'On a call', events: [{ id: 'call' }], config: {} };
  const TRIGGERS: Bag[] = [schedule('10 * * * *'), schedule('*/30 * * * *', ZONE, 'skip'), EVENT];

  /** The definition kept: VS Code's file could hold none of these triggers. */
  const definition = (folder = join(work, 'ahpd')): Bag => ({
    ...entry(TRIGGERS).definition,
    session: { provider: 'claude', workingDirectories: [pathToFileURL(folder).href] },
    _meta: { ahpd: { session: 'pinned', overlap: 'skip', pinnedSession: 'ahp-session:/claude/kept' } },
  });

  /** The daemon's folder, holding one automation. */
  const kept = (held: Bag = definition()): void => {
    const store = scheduledAutomations({ dir: automationsDir(), state: automationStatePath(), timer: () => ({ cancel: () => {} }) });
    store.create(`ahp-automation:/${ID}`, held, 'user:softov');
    store.close?.();
  };

  /** Every automation the daemon's folder holds now. */
  const held = (): AutomationEntry[] => {
    const store = scheduledAutomations({ dir: automationsDir(), state: automationStatePath(), timer: () => ({ cancel: () => {} }) });
    const all = store.list();
    store.close?.();
    return all;
  };

  const run = async (id: string, input: Record<string, unknown>): Promise<{ data: unknown; text: string }> => {
    const registry = cliRegistry();
    const command = registry.find(id);
    if (command === undefined) throw new Error(`no ${id}`);
    const said = await registry.execute(command, { surface: 'cli', input: { ...(id === 'automation.import' ? { configFile: config } : {}), ...input }, readStdin: async () => '' });
    if (said === null) throw new Error('answered nothing');
    return { data: said.data, text: typeof said.plain === 'function' ? said.plain() : said.plain ?? '' };
  };

  /** The text export writes for the kept automation, and the file it wrote. */
  const exported = async (): Promise<{ text: string; file: string; fileName: string }> => {
    const file = join(home, 'out.automation.md');
    const said = await run('automation.export', { id: ID, out: file });
    const data = said.data as { text: string; fileName: string };
    return { text: data.text, file, fileName: data.fileName };
  };

  it('writes every trigger, zone and setting, without the owner, the time or the id', async () => {
    kept();
    const { text, file, fileName } = await exported();
    expect(fileName).toBe('review-yesterday-s-commits.automation.md');
    expect(readFileSync(file, 'utf8')).toBe(text);
    const fields = header(text);
    expect(fields['triggers']).toEqual(TRIGGERS);
    expect(fields).toMatchObject({ title: 'Review yesterday\'s commits', enabled: true, _meta: { ahpd: { session: 'pinned', overlap: 'skip' } } });
    expect(fields['owner']).toBeUndefined();
    expect(fields['createdAt']).toBeUndefined();
    expect(fields['id']).toBeUndefined();
    expect(fields['message.text']).toBeUndefined();
    expect((fields['_meta'] as { ahpd: Bag }).ahpd['pinnedSession']).toBeUndefined();
    expect(text.endsWith('---\nReview the commits.\n')).toBe(true);
  });

  it('imports back to the same schedule, switched off, in the folder the file names', async () => {
    kept();
    const { file } = await exported();
    const said = await run('automation.import', { file });
    const { id, resource } = said.data as { id: string; resource: string };
    expect(id).not.toBe(ID);
    expect(said.text).toBe(`Imported Review yesterday's commits as ${id}. It is switched off.\n`);
    const one = held().find((each) => each.resource === resource);
    const { _meta, ...rest } = definition();
    expect(one?.definition).toEqual({ ...rest, _meta: { ahpd: { session: 'pinned', overlap: 'skip' } }, enabled: false });
  });

  it('keeps America/Campo_Grande through the round trip', async () => {
    kept({ ...definition(), triggers: [schedule('0 9 * * 1-5', ZONE)] });
    const { file } = await exported();
    const { resource } = (await run('automation.import', { file })).data as { resource: string };
    const triggers = held().find((each) => each.resource === resource)?.definition['triggers'] as Bag[];
    expect(triggers).toEqual([schedule('0 9 * * 1-5', ZONE)]);
  });

  it('replaces the file\'s folder with --folder', async () => {
    kept();
    const { file } = await exported();
    const { resource } = (await run('automation.import', { file, folder: work })).data as { resource: string };
    expect(held().find((each) => each.resource === resource)?.definition['session']).toEqual({
      provider: 'claude',
      workingDirectories: [pathToFileURL(work).href],
    });
  });

  it('refuses a file\'s folder this host does not serve, unless --folder is given', async () => {
    const outside = join(home, 'elsewhere');
    mkdirSync(outside);
    kept(definition(outside));
    const { file } = await exported();
    await expect(run('automation.import', { file })).rejects.toThrow(`${outside} is not a folder this host serves. Add it with ahpd paths add.`);
    expect(held()).toHaveLength(1);
    await run('automation.import', { file, folder: work });
    expect(held()).toHaveLength(2);
  });

  it('refuses a file that names no folder, without --folder', async () => {
    kept({ ...definition(), session: { provider: 'claude' } });
    const { file } = await exported();
    await expect(run('automation.import', { file })).rejects.toThrow('automation import needs --folder: the file names no folder to run in.');
  });

  it('refuses VS Code\'s file without --vscode, with its sentence', async () => {
    await expect(run('automation.import', { file: FIXTURE, folder: work })).rejects.toThrow(`${FIXTURE}: This is a VS Code automation file. Add --vscode.`);
    expect(held()).toEqual([]);
  });

  it('refuses a file with no frontmatter', async () => {
    const file = join(home, 'plain.automation.md');
    writeFileSync(file, 'Do it.\n');
    await expect(run('automation.import', { file, folder: work })).rejects.toThrow(`${file}: The file cannot be read: it does not open with a --- line.`);
  });

  it('gives VS Code\'s file with --vscode, as before', async () => {
    kept({ ...definition(), triggers: [schedule('0 9 * * *', Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')] });
    const said = await run('automation.export', { id: ID, vscode: true });
    const text = (said.data as { text: string }).text;
    expect(text).toBe(serializeAutomationBlueprint(automationToBlueprint({ ...entry([]), resource: `ahp-automation:/${ID}`, definition: held()[0]?.definition ?? {} })));
    expect(parseAutomationBlueprint(text).schedule).toMatchObject({ interval: 'daily', scheduleHour: 9 });
    kept();
    await expect(run('automation.export', { id: ID, vscode: true })).rejects.toThrow(`${ID} has an event trigger, and a VS Code automation file holds only a schedule.`);
  });

  describe('served', () => {
    let store: AutomationStore;
    beforeEach(() => {
      store = memoryAutomations();
      store.create(`ahp-automation:/${ID}`, definition());
    });

    const facts = (): ServedFacts => ({
      options: optionsFrom({ configFile: config }),
      configFile: config,
      running: () => ({ pid: process.pid, url: `ws://${AUTHORITY}`, host: '127.0.0.1', port: 9361, paths: [work], startedAt: '' }),
      turning: () => [],
      automations: () => store,
      restart: () => {},
    });

    const call = async (path: string, body?: unknown): Promise<Response> => {
      const handler = apiHandler({
        registry: servedRegistry(facts()),
        token: 'root-secret',
        program: { name: 'ahpd', version: '0.0.0' },
        origins: () => apiOrigins('127.0.0.1', undefined, 9361),
      });
      return handler(new Request(`http://${AUTHORITY}/api${path}`, {
        ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
        headers: { host: AUTHORITY, 'content-type': 'application/json', authorization: 'Bearer root-secret' },
      }));
    };

    it('exports ahpd\'s file and imports it from the body', async () => {
      const answer = await call(`/automation/export/${ID}`);
      expect(answer.status).toBe(200);
      const { text } = await answer.json() as { text: string };
      expect(header(text)['triggers']).toEqual(TRIGGERS);
      const made = await call('/automation/import', { text });
      expect(made.status).toBe(200);
      const { resource } = await made.json() as { resource: string };
      expect(store.get(resource)?.definition).toMatchObject({ enabled: false, triggers: TRIGGERS });
    });

    it('refuses VS Code\'s file without --vscode', async () => {
      const answer = await call('/automation/import', { text: readFileSync(FIXTURE, 'utf8'), folder: work });
      expect(answer.status).toBe(400);
      expect((await answer.json() as { message: string }).message).toBe('This is a VS Code automation file. Add --vscode.');
    });
  });
});
