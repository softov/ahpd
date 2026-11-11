import { expect, it } from 'vitest';
import { RecordGaps } from '../src/channels/owners.js';
import { alertList, dropOpenAlerts, raiseOpenAlerts } from '../src/plugins/alerts.js';

/*
 * The list a plugin, an agent and a connector keep their alerts in: one alert
 * per `ref`, the newest at the end, and the oldest gone past the limit.
 */

it('replaces an alert with the same ref, and keeps it at the end', () => {
  const alerts = alertList(10);
  alerts.add({ level: 'warning', text: 'the key is old', ref: 'secret:KEY' });
  alerts.add({ level: 'error', text: 'the call failed', ref: 'call' });
  alerts.add({ level: 'error', text: 'the key is gone', ref: 'secret:KEY' });

  expect(alerts.list().map((one) => [one.ref, one.text])).toEqual([
    ['call', 'the call failed'],
    ['secret:KEY', 'the key is gone'],
  ]);
});

it('drops an alert by its ref, and stamps an alert that has no time', () => {
  const alerts = alertList(10);
  alerts.add({ level: 'warning', text: 'the probe did not answer', ref: 'probe' });
  alerts.add({ level: 'error', text: 'the vault holds no KEY', ref: 'secret:KEY' });

  expect(alerts.drop('probe')).toBe(true);
  expect(alerts.drop('probe')).toBe(false);
  expect(alerts.list().map((one) => one.ref)).toEqual(['secret:KEY']);
  expect(alerts.list()[0]?.at).toEqual(expect.any(String));
  expect(Number.isNaN(Date.parse(alerts.list()[0]?.at ?? ''))).toBe(false);
});

it('keeps a time an alert came with', () => {
  const alerts = alertList(10);
  alerts.add({ level: 'notice', text: 'the store was read again', ref: 'store', at: '2026-11-10T09:00:00.000Z' });

  expect(alerts.list()[0]?.at).toBe('2026-11-10T09:00:00.000Z');
});

it('drops the oldest alert past the limit', () => {
  const alerts = alertList(2);
  alerts.add({ level: 'warning', text: 'one', ref: 'one' });
  alerts.add({ level: 'warning', text: 'two', ref: 'two' });
  alerts.add({ level: 'warning', text: 'three', ref: 'three' });

  expect(alerts.list().map((one) => one.text)).toEqual(['two', 'three']);
});

it('clears every alert', () => {
  const alerts = alertList(10);
  alerts.add({ level: 'warning', text: 'one', ref: 'one' });
  alerts.add({ level: 'error', text: 'two', ref: 'two' });

  alerts.clear();
  expect(alerts.list()).toEqual([]);
});

it('puts the alerts of a failed open in place of the last ones, and keeps the others', () => {
  const alerts = alertList(10);
  alerts.add({ level: 'warning', text: 'the probe failed', ref: 'probe' });
  raiseOpenAlerts(alerts, new RecordGaps([
    { ref: 'env:A', text: 'the environment holds no A' },
    { ref: 'secret:b', text: 'the vault holds no b' },
  ]), 'could not open');
  raiseOpenAlerts(alerts, new RecordGaps([{ ref: 'secret:b', text: 'the vault holds no b' }]), 'could not open');
  expect(alerts.list().map((one) => one.ref)).toEqual(['probe', 'secret:b']);

  raiseOpenAlerts(alerts, new Error('x'.repeat(20)), 'could not open', 5);
  expect(alerts.list().map((one) => [one.ref, one.text])).toEqual([['probe', 'the probe failed'], ['open', 'xxxxx']]);

  raiseOpenAlerts(alerts, new Error(''), 'could not open');
  expect(alerts.list().at(-1)).toMatchObject({ ref: 'open', text: 'could not open' });

  dropOpenAlerts(alerts);
  expect(alerts.list().map((one) => one.ref)).toEqual(['probe']);
});
