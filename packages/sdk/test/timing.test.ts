import { expect, it } from 'vitest';
import { callTimes, withCallTimes, startOf } from '../src/timing.js';

/*
 * A tool call's times, in the bag every action of that call carries.
 *
 * The protocol gives a tool call no time of its own, so the times ride in its
 * `_meta` and the plugin that ran the call is the one that stamps them. An
 * action carrying a `_meta` replaces the call's whole bag, which is why the
 * times are built here and merged into what a call already has.
 */

const START = Date.UTC(2026, 8, 29, 12, 0, 0);

it('merging keeps the keys the bag already had', () => {
  const meta = withCallTimes(
    { toolKind: 'terminal', subagentChatUri: 'ahp-chat://default/d29ya2Vy' },
    callTimes(START),
  );
  expect(meta.toolKind).toBe('terminal');
  expect(meta.subagentChatUri).toBe('ahp-chat://default/d29ya2Vy');
  expect(meta['ahpd.startedAt']).toBe('2026-09-29T12:00:00.000Z');
});

it('merges into nothing', () => {
  expect(withCallTimes(undefined, callTimes(START))).toEqual({ 'ahpd.startedAt': '2026-09-29T12:00:00.000Z' });
});

it('measures the duration as the difference of the two times', () => {
  const meta = callTimes(START, START + 1500);
  expect(meta['ahpd.endedAt']).toBe('2026-09-29T12:00:01.500Z');
  expect(meta['ahpd.durationMs']).toBe(1500);
});

it('keeps a duration the harness measured', () => {
  expect(callTimes(START, START + 4000, 17)['ahpd.durationMs']).toBe(17);
});

it('never measures below zero', () => {
  expect(callTimes(START, START - 40)['ahpd.durationMs']).toBe(0);
});

it('with no end says only when it started', () => {
  expect(callTimes(START)).toEqual({ 'ahpd.startedAt': '2026-09-29T12:00:00.000Z' });
});

it('an ISO start and an epoch start are the same time', () => {
  const iso = '2026-09-29T12:00:00.000Z';
  expect(callTimes(iso)['ahpd.startedAt']).toBe(iso);
  expect(callTimes(START)['ahpd.startedAt']).toBe(iso);
  expect(callTimes(iso, iso)['ahpd.durationMs']).toBe(0);
});

it('reads a start back as epoch milliseconds', () => {
  expect(startOf(callTimes(START))).toBe(START);
  expect(startOf(withCallTimes({ toolKind: 'terminal' }, callTimes(START, START + 10)))).toBe(START);
});

it('reads back nothing from a bag with no start, or with one it did not write', () => {
  expect(startOf(undefined)).toBeUndefined();
  expect(startOf({ toolKind: 'terminal' })).toBeUndefined();
  expect(startOf({ startedAt: String(START) })).toBeUndefined();
  expect(startOf('not a bag')).toBeUndefined();
});

it('never writes a bare timing key', () => {
  const written = [...Object.keys(callTimes(START, START + 1, 1)), ...Object.keys(withCallTimes({ toolKind: 'terminal' }, callTimes(START)))];
  expect(written).not.toContain('startedAt');
  expect(written).not.toContain('endedAt');
  expect(written).not.toContain('durationMs');
});
