import { loggerOf } from '@ahpd/sdk';
import { describe, expect, it } from 'vitest';
import { memoryRecords, pluginHost, raise } from '@ahpd/sdk';
import { apply, defaults, name, settingsOf, title } from '../src/plugin.js';
import manifest from '../package.json' with { type: 'json' };
import type { LoaderContext, RecordStore } from '@ahpd/sdk';

/*
 * The two settings of the tasks plugin.
 *
 * Both are off by default, and each reads the option it is given. A value of
 * the wrong kind is reported through the host and costs that setting alone,
 * which is what a host built by hand gets when it skips the schema.
 */

const context = (): LoaderContext => ({
  path: '/tmp/tasks',
  paths: ['/tmp/tasks'],
  version: '0.12.0',
  hostName: 'tasks-test',
  configDir: '/tmp/tasks',
  log: loggerOf(() => {}),
  say: () => {},
});

/** The schema the manifest declares, which a listing reads without importing. */
const optionsSchema = manifest.ahpd.optionsSchema;

describe('the tasks plugin', () => {
  it('calls itself tasks, prints Tasks, and declares both settings', () => {
    expect(name).toBe('tasks');
    expect(title).toBe('Tasks');
    expect(optionsSchema.properties).toHaveProperty('requireApproval');
    expect(optionsSchema.properties).toHaveProperty('sweepAfterDays');
  });

  it('has approval off and keeps every plan when it is given nothing', () => {
    const problems: string[] = [];
    expect(settingsOf({}, (line) => { problems.push(line); })).toEqual({ requireApproval: false });
    expect(problems).toEqual([]);
    expect(defaults.requireApproval).toBe(false);
  });

  it('takes a value that is set', () => {
    const problems: string[] = [];
    expect(settingsOf({ requireApproval: true, sweepAfterDays: 7 }, (line) => { problems.push(line); }))
      .toEqual({ requireApproval: true, sweepAfterDays: 7 });
    expect(problems).toEqual([]);
    expect(settingsOf({ requireApproval: false }, () => {})).toEqual({ requireApproval: false });
  });

  it('reports a value of the wrong kind and keeps that setting off', () => {
    const problems: string[] = [];
    expect(settingsOf({ requireApproval: 'yes', sweepAfterDays: 1.5 }, (line) => { problems.push(line); }))
      .toEqual({ requireApproval: false });
    expect(problems).toEqual([
      'tasks: requireApproval is "yes", which is not true or false; using false',
      'tasks: sweepAfterDays is 1.5, which is not a whole number of days; keeping finished plans forever',
    ]);
    expect(settingsOf({ sweepAfterDays: 0 }, () => {})).toEqual({ requireApproval: false });
  });

  it('reports a wrong kind through the host when apply reads it', async () => {
    const problems: string[] = [];
    const { host, seal } = pluginHost(name, context(), { alert: (alert) => { problems.push(alert.text); } });
    await apply(host, { sweepAfterDays: 'soon' });
    seal();
    expect(problems).toEqual([
      'tasks: sweepAfterDays is "soon", which is not a whole number of days; keeping finished plans forever',
    ]);
  });

  it('says nothing for the options it was written for', async () => {
    const problems: string[] = [];
    const { host, seal } = pluginHost(name, context(), { alert: (alert) => { problems.push(alert.text); } });
    await apply(host, { requireApproval: true, sweepAfterDays: 30 });
    seal();
    expect(problems).toEqual([]);
  });

  /*
   * A pass that fails is something that went wrong in the daemon, which goes
   * to its log, as VS Code's lifecycle pass logs its own:
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionLifecycle.ts#L102
   */
  it('logs a sweep that did not finish, and raises no alert for it', async () => {
    const logged: string[] = [];
    const problems: string[] = [];
    const records = memoryRecords();
    // A store whose plans cannot be listed, which is the first thing a sweep reads.
    const failing: RecordStore = {
      ...records,
      collection: async (named, wanted) => {
        const collection = await records.collection(named, wanted);
        return named === 'plans' ? { ...collection, list: async () => { throw new Error('the disk went away'); } } : collection;
      },
    };
    const { host, contribution, seal } = pluginHost(name, { ...context(), log: loggerOf((line: string) => { logged.push(line); }) }, {
      records: () => failing,
      alert: (alert) => { problems.push(alert.text); },
    });
    await apply(host, { sweepAfterDays: 30 });
    seal();
    const until = Date.now() + 5000;
    while (!logged.some((line) => line.includes('the sweep did not finish')) && Date.now() < until) {
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
    expect(logged).toContain('tasks: the sweep did not finish: the disk went away');
    expect(problems).toEqual([]);
    await raise(contribution.events, { type: 'stopping' });
  });
});
