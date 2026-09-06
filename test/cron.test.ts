import { expect, it, describe } from 'vitest';
import { parseCron, nextOccurrence } from '../packages/sdk/src/cron.js';

/*
 * Five-field cron, as the protocol defines it.
 *
 * The interesting cases are all calendar cases: the day fields combine in a
 * way nothing else in computing does, and a time zone is a thing that moves
 * under you twice a year. An expression that is merely parsed is not checked -
 * what matters is the instant it names.
 */

/** The next occurrence as an ISO string, which is what a `nextRunAt` is. */
const next = (expression: string, from: string, timeZone = 'UTC'): string => {
  const at = nextOccurrence(parseCron(expression), new Date(from), timeZone);
  return at ? at.toISOString() : 'never';
};

describe('when an expression comes round', () => {
  it('skips the weekend for a weekday schedule', () => {
    // Friday evening. The next 09:30 is Monday's, not Saturday's.
    expect(next('30 9 * * 1-5', '2026-08-28T20:00:00Z')).toBe('2026-08-31T09:30:00.000Z');
  });

  it('takes a step from the top of the hour, not from now', () => {
    expect(next('*/15 * * * *', '2026-08-31T10:07:00Z')).toBe('2026-08-31T10:15:00.000Z');
  });

  it('reads month and weekday names', () => {
    expect(next('0 0 * JAN SUN', '2026-08-31T00:00:00Z')).toBe('2027-01-03T00:00:00.000Z');
  });

  it('finds a date that is only in some years', () => {
    expect(next('0 0 29 2 *', '2026-01-01T00:00:00Z')).toBe('2028-02-29T00:00:00.000Z');
  });

  it('answers never for a date that never comes', () => {
    // The 30th of February. Parseable, and not a day.
    expect(next('0 0 30 2 *', '2026-01-01T00:00:00Z')).toBe('never');
  });
});

describe('the two day fields', () => {
  /*
   * Unix cron's one genuine oddity, and the one worth a test of its own: with
   * both day fields restricted the match is *either*, so this fires on the
   * first of the month and on every Monday. Read as "and" it would be a
   * handful of days a year instead of fifty.
   */
  it('takes either day when both are restricted', () => {
    // From Wednesday the 2nd: the next Monday is the 7th, before the 1st of October.
    expect(next('0 0 1 * 1', '2026-09-02T00:00:00Z')).toBe('2026-09-07T00:00:00.000Z');
  });

  it('takes the day of month alone when the weekday is *', () => {
    expect(next('0 0 1 * *', '2026-09-02T00:00:00Z')).toBe('2026-10-01T00:00:00.000Z');
  });

  it('reads both spellings of Sunday', () => {
    expect(next('0 0 * * 7', '2026-08-31T00:00:00Z')).toBe(next('0 0 * * 0', '2026-08-31T00:00:00Z'));
  });
});

describe('a schedule in a time zone', () => {
  it('is the zone that decides the instant', () => {
    // 09:00 in Sao Paulo is 12:00 UTC, and a host reading it as its own local
    // time would run somebody's nightly job in the middle of their afternoon.
    expect(next('0 9 * * *', '2026-08-31T20:00:00Z', 'America/Sao_Paulo')).toBe('2026-09-01T12:00:00.000Z');
  });

  it('skips a wall time the spring forward removed', () => {
    // 02:30 does not happen on 2027-03-14 in New York, so the daily 02:30 goes
    // straight to the 15th. Firing it at 03:30 instead would be inventing an
    // occurrence nobody asked for.
    expect(next('30 2 * * *', '2027-03-13T08:00:00Z', 'America/New_York')).toBe('2027-03-15T06:30:00.000Z');
  });

  it('takes the first of a wall time the fall back repeats', () => {
    // 01:30 happens twice on 2027-11-07. The first is EDT, at 05:30Z.
    expect(next('30 1 7 11 *', '2027-11-01T00:00:00Z', 'America/New_York')).toBe('2027-11-07T05:30:00.000Z');
  });
});

describe('an expression that is not one', () => {
  /*
   * Refused at the moment it is written, which is the only moment anybody is
   * there to fix it. Accepted and never fired, a typo is a job that silently
   * does not run.
   */
  it.each([
    ['', 'has no fields'],
    ['* * * *', 'has four'],
    ['* * * * * *', 'has six'],
    ['60 * * * *', 'is a minute that does not exist'],
    ['* 24 * * *', 'is an hour that does not exist'],
    ['* * * * 8', 'is a weekday that does not exist'],
    ['*/0 * * * *', 'steps by nothing'],
    ['5-1 * * * *', 'runs backwards'],
    ['x * * * *', 'is not a number'],
    ['@daily', 'is a macro, which AHP does not have'],
  ])('refuses %j, which %s', (expression) => {
    expect(() => parseCron(expression)).toThrow();
  });
});
