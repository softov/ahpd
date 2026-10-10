import { describe, expect, it } from 'vitest';
import { Status, activityOf, statusOf, titleFrom } from '../src/catalog.js';
import type { Bag, Emit } from '../src/types/index.js';

/*
 * The pieces every backend used to write for itself.
 *
 * What is under test is the shared answer: which of the protocol's status bits
 * a session reports, and what goes on the two activity channels. The backends
 * are checked where they are, in their own packages.
 */

/** One action, as the emitter was handed it, with the channel it went out on. */
interface Sent {
  channel: string;
  action: Bag;
}

/** An emitter that keeps what it was handed, so a test reads the actions sent. */
const recorder = (): { emit: Emit; sent: Sent[] } => {
  const sent: Sent[] = [];
  return { sent, emit: (channel, action) => { sent.push({ channel, action }); } };
};

describe('what status a session reports', () => {
  it('is idle when nothing holds', () => {
    expect(statusOf({ waiting: false, active: false, failed: false })).toBe(Status.Idle);
  });

  it('is in progress while a turn runs', () => {
    expect(statusOf({ waiting: false, active: true, failed: false })).toBe(Status.InProgress);
  });

  it('is an error when the last turn failed', () => {
    expect(statusOf({ waiting: false, active: false, failed: true })).toBe(Status.Error);
  });

  it('is waiting when somebody is being asked, whatever else holds', () => {
    // `InputNeeded` (24) carries `InProgress` (8), so a reader that tested
    // activity first would draw a session that is really asking as working.
    expect(statusOf({ waiting: true, active: false, failed: false })).toBe(Status.InputNeeded);
    expect(statusOf({ waiting: true, active: true, failed: false })).toBe(Status.InputNeeded);
    expect(statusOf({ waiting: true, active: true, failed: true })).toBe(Status.InputNeeded);
  });
});

describe('what a session says it is doing', () => {
  it('says one line on both channels, in that order', () => {
    const { emit, sent } = recorder();
    activityOf(emit).say('Thinking');
    expect(sent).toEqual([
      { channel: 'chat', action: { type: 'chat/activityChanged', activity: 'Thinking' } },
      { channel: 'session', action: { type: 'session/activityChanged', activity: 'Thinking' } },
    ]);
  });

  it('says nothing when the line did not change', () => {
    const { emit, sent } = recorder();
    const activity = activityOf(emit);
    activity.say('Thinking');
    activity.say('Thinking');
    expect(sent).toHaveLength(2);
  });

  it('says the line again once it has changed and come back', () => {
    const { emit, sent } = recorder();
    const activity = activityOf(emit);
    activity.say('Thinking');
    activity.say('Running');
    activity.say('Thinking');
    expect(sent.map((one) => one.action.activity)).toEqual(['Thinking', 'Thinking', 'Running', 'Running', 'Thinking', 'Thinking']);
  });

  it('answers the last line it said', () => {
    const { emit } = recorder();
    const activity = activityOf(emit);
    expect(activity.current()).toBeUndefined();
    activity.say('Thinking');
    expect(activity.current()).toBe('Thinking');
  });

  it('clears the line on both channels, with no `activity` key at all', () => {
    const { emit, sent } = recorder();
    const activity = activityOf(emit);
    activity.say('Thinking');
    sent.length = 0;
    activity.say(undefined);
    // A key that is there and empty is not the same as one that is absent: the
    // protocol reads an absent `activity` as the session being idle.
    expect(sent).toEqual([
      { channel: 'chat', action: { type: 'chat/activityChanged' } },
      { channel: 'session', action: { type: 'session/activityChanged' } },
    ]);
    expect(activity.current()).toBeUndefined();
  });

  it('says nothing when there was nothing to clear', () => {
    const { emit, sent } = recorder();
    activityOf(emit).say(undefined);
    expect(sent).toEqual([]);
  });
});

describe('the title a first message gives a session', () => {
  it('is the first line, trimmed, without the lines after it', () => {
    expect(titleFrom('Fix the build\nand the tests', 'untitled')).toBe('Fix the build');
    expect(titleFrom('\n  hello\nworld', 'untitled')).toBe('hello');
    expect(titleFrom('  A pasted snippet  ', 'untitled')).toBe('A pasted snippet');
  });

  it('cuts a long line at 80 characters', () => {
    const long = 'x'.repeat(100);
    expect(titleFrom(long, 'untitled')).toBe('x'.repeat(80));
    // A line that fits is kept whole, spaces and all.
    expect(titleFrom('y'.repeat(70), 'untitled')).toBe('y'.repeat(70));
  });

  it('takes the caller\'s width', () => {
    expect(titleFrom('x'.repeat(100), 'untitled', 60)).toBe('x'.repeat(60));
  });

  it('answers the fallback for a message that is blank throughout', () => {
    expect(titleFrom('', 'untitled')).toBe('untitled');
    expect(titleFrom('  \n ', 'untitled')).toBe('untitled');
    expect(titleFrom('\n\n', 'untitled')).toBe('untitled');
  });
});
