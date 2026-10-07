import { expect, it } from 'vitest';
import type { AutomationTriggerDefinition, ConfigPropertySchema } from '@microsoft/agent-host-protocol';
import { memoryAutomations } from '../src/automations.js';
import { scheduledAutomations } from '../src/scheduled.js';
import { presetById } from '../src/triggerpresets.js';
import type { Bag } from '../src/types/common.js';

/*
 * The trigger types a host lists, and the configs it will not hold.
 *
 * A client draws the automation form from `triggers`, so what is checked here
 * is what it is told: which types exist, which events each one offers, and the
 * shape of the config behind them. The refusals are the other half - a rule
 * this host cannot honour is one it will not save, rather than one that is
 * accepted and never fires.
 */

/** One automation with a single event trigger, as a client would write it. */
const definition = (config: Bag, event = 'turnFailed'): Bag => ({
  title: 'Triage',
  enabled: true,
  triggers: [{
    id: 't1',
    kind: 'event',
    type: 'session',
    title: 'What a session does',
    events: [{ id: event, title: event }],
    config,
  }],
});

/** One automation with a single preset trigger, as a client picking a form entry writes it. */
const preset = (config: Bag, event = 'long-silent-turn'): Bag => ({
  title: 'Triage',
  enabled: true,
  triggers: [{
    id: 't1',
    kind: 'event',
    type: 'watch',
    title: 'A pattern',
    events: [{ id: event, title: event }],
    config,
  }],
});

/** What a client draws the config form from: the trigger type's own schema. */
const properties = (type: AutomationTriggerDefinition): Record<string, ConfigPropertySchema> =>
  type.configSchema?.properties ?? {};

/** The fields of one property that is itself an object. */
const fields = (property: ConfigPropertySchema | undefined): Record<string, ConfigPropertySchema> =>
  property?.properties ?? {};

it('lists the session and watch trigger types with their events', () => {
  const types = memoryAutomations().triggers({});
  expect(types.map((one) => one.type)).toEqual(['session', 'watch']);

  const session = types[0] as AutomationTriggerDefinition;
  expect(typeof session.title).toBe('string');
  expect(session.events.map((one) => one.id)).toEqual([
    'turnCompleted', 'turnFailed', 'turnCancelled', 'toolCalled',
    'toolFailed', 'messageQueued', 'idle', 'childFinished',
  ]);
  // Every event a client may pick is named and described, because that is all
  // the client has to draw the row with.
  for (const one of session.events) {
    expect(typeof one.title).toBe('string');
    expect(typeof one.description).toBe('string');
  }

  // The config is the rule without `on`, which is the event the client picked.
  const rule = properties(session);
  expect(Object.keys(rule)).toEqual(['filter', 'count', 'then', 'when']);
  expect(Object.keys(fields(rule.count))).toEqual(['n', 'consecutive', 'within', 'sameInput']);
  expect(fields(rule.then).kind?.enum).toEqual(['event', 'idle', 'absent']);
  // Every fact an event carries is offered, which since the host puts the
  // session's folders and whether a run made it on each one is six of them.
  expect(Object.keys(fields(rule.filter)))
    .toEqual(['sessions', 'providers', 'owners', 'projects', 'folders', 'automated']);
  expect(Object.keys(fields(rule.when)))
    .toEqual(['running', 'queuedAtLeast', 'toolCallsAtLeast', 'turnLongerThan']);
  expect(fields(rule.then).event?.enum).toEqual(session.events.map((one) => one.id));

  const watch = types[1] as AutomationTriggerDefinition;
  expect(watch.events.map((one) => one.id)).toEqual([
    'looks-stuck', 'failing-tools', 'long-silent-turn', 'idle-after-failure', 'waiting-while-busy',
  ]);
  // The presets' numbers, each with the default a client shows.
  const numbers = properties(watch);
  expect(numbers.times?.default).toBe(3);
  expect(numbers.minutes?.default).toBe(3);
  expect(numbers.toolCalls?.default).toBe(3);
  expect(Object.keys(fields(numbers.filter)))
    .toEqual(['sessions', 'providers', 'owners', 'projects', 'folders', 'automated']);
});

it('answers the same types from the store the daemon is built over', () => {
  const types = scheduledAutomations({ file: '/tmp/ahpd-none.json' }).triggers({});
  expect(types.map((one) => one.type)).toEqual(['session', 'watch']);
});

it('builds each preset into a rule with its default numbers', () => {
  expect(presetById('looks-stuck')?.rule({})).toEqual({ on: 'toolCalled', count: { n: 3, sameInput: true } });
  expect(presetById('failing-tools')?.rule({})).toEqual({ on: 'toolFailed', count: { n: 3, consecutive: true } });
  expect(presetById('long-silent-turn')?.rule({}))
    .toEqual({ on: 'turnCompleted', when: { turnLongerThan: '10m' } });
  expect(presetById('idle-after-failure')?.rule({})).toEqual({ on: 'turnFailed', then: { kind: 'idle', for: '3m' } });
  expect(presetById('waiting-while-busy')?.rule({}))
    .toEqual({ on: 'messageQueued', when: { running: true, toolCallsAtLeast: 3 } });

  // The numbers are the person's, and a filter rides along on any of them.
  expect(presetById('looks-stuck')?.rule({ times: 5 })).toEqual({ on: 'toolCalled', count: { n: 5, sameInput: true } });
  expect(presetById('long-silent-turn')?.rule({ minutes: 20 }))
    .toEqual({ on: 'turnCompleted', when: { turnLongerThan: '20m' } });
  expect(presetById('idle-after-failure')?.rule({ minutes: 10 }))
    .toEqual({ on: 'turnFailed', then: { kind: 'idle', for: '10m' } });
  expect(presetById('failing-tools')?.rule({ filter: { owners: ['user:softov'] } }))
    .toEqual({ on: 'toolFailed', count: { n: 3, consecutive: true }, filter: { owners: ['user:softov'] } });
  expect(presetById('no-such-preset')).toBeUndefined();
});

it('refuses a trigger whose count is not a positive number', () => {
  const store = memoryAutomations();
  expect(() => store.create('ahp-automation:/none', definition({ count: { n: 0 } })))
    .toThrow(/count\.n/);
  expect(() => store.create('ahp-automation:/half', definition({ count: { n: 1.5 } })))
    .toThrow(/count\.n/);
  expect(() => store.create('ahp-automation:/word', definition({ count: { n: 'three' } })))
    .toThrow(/count\.n/);
  // Nothing was written, so the catalogue a client reads back is unchanged.
  expect(store.list()).toEqual([]);
});

it('refuses a preset number below one', () => {
  const store = memoryAutomations();
  // Every number a preset carries counts something - minutes of quiet, times a
  // call has repeated, tool calls in a turn - so zero is a pattern that matches
  // the moment anything happens, and a fraction of a minute of quiet is not a
  // length anybody meant.
  expect(() => store.create('ahp-automation:/now', preset({ minutes: 0 }))).toThrow(/minutes/);
  expect(() => store.create('ahp-automation:/half', preset({ minutes: 0.5 }))).toThrow(/minutes/);
  expect(() => store.create('ahp-automation:/word', preset({ minutes: 'five' }))).toThrow(/minutes/);
  expect(() => store.create('ahp-automation:/often', preset({ times: 0 }, 'looks-stuck'))).toThrow(/times/);
  // Nothing was written, and the one a person would pick is kept as it was.
  expect(store.list()).toEqual([]);
  expect(store.create('ahp-automation:/quiet', preset({ minutes: 1 })).resource).toBe('ahp-automation:/quiet');
});

it('refuses a duration it cannot read', () => {
  const store = memoryAutomations();
  expect(() => store.create('ahp-automation:/soon', definition({ count: { n: 2, within: 'soon' } })))
    .toThrow(/count\.within/);
  expect(() => store.create('ahp-automation:/five', definition({ then: { kind: 'idle', for: '5' } })))
    .toThrow(/then\.for/);
  expect(() => store.create('ahp-automation:/later', definition({ then: { kind: 'event', event: 'idle', within: 'a bit' } })))
    .toThrow(/then\.within/);
  // One it can read is kept as it was written.
  const held = store.create('ahp-automation:/quiet', definition({ count: { n: 2, within: '5m' } }));
  expect(held.resource).toBe('ahp-automation:/quiet');
});

it('takes a rule about a folder, a run-made session or a turn length', () => {
  const store = memoryAutomations();
  // Every fact an event carries is a fact a rule may be written on, so these
  // are kept rather than refused.
  const kept: [string, Bag][] = [
    ['folder', { filter: { folders: ['file:///home/softov'] } }],
    ['made', { filter: { automated: true } }],
    ['turn', { when: { turnLongerThan: '10m' } }],
  ];
  for (const [name, config] of kept) {
    expect(store.create(`ahp-automation:/${name}`, definition(config)).resource).toBe(`ahp-automation:/${name}`);
  }
  // A turn length is a duration like the others, so one that cannot be read is
  // refused naming the field rather than kept as a rule that never fires.
  expect(() => store.create('ahp-automation:/soon', definition({ when: { turnLongerThan: 'soon' } })))
    .toThrow(/when\.turnLongerThan/);
  // And a key no schema names at all is refused with the key named.
  expect(() => store.create('ahp-automation:/other', definition({ whenever: {} })))
    .toThrow(/whenever/);
});

it('refuses a patch that carries a rule it cannot honour', () => {
  const store = memoryAutomations();
  store.create('ahp-automation:/one', definition({ count: { n: 2, consecutive: true } }));
  // A patch about something else is not a patch about the rule, so an
  // automation written before this store checked anything is still editable.
  expect(store.update('ahp-automation:/one', { title: 'Other' })?.definition.title).toBe('Other');
  const bad = (definition({ count: { n: -1 } }).triggers as Bag[])[0];
  expect(() => store.update('ahp-automation:/one', { triggers: [bad] })).toThrow(/count\.n/);
  // And what it holds is still the rule it took.
  expect(((store.get('ahp-automation:/one')?.definition.triggers as Bag[])[0]?.config as Bag).count)
    .toEqual({ n: 2, consecutive: true });
});
