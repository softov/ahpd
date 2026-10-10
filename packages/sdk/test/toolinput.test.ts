import { describe, expect, it } from 'vitest';
import { flag, optional, required, when } from '../src/toolinput.js';

/*
 * The readers for a tool's input fields, one per kind of field.
 *
 * What is under test is the answer and the sentence. A model that got a
 * refusal fixes the call from its text, and the text names the tool and the
 * field it was given, so the tools in this package cannot drift apart in what
 * they say. The tools themselves are in `sessiontools.test.ts` and
 * `artifacttools.test.ts`, which this refactor leaves as they are.
 */

/** The tool a reader was called for; any name would do, and this one is real. */
const TOOL = 'list_sessions';

describe('the text a tool must be given', () => {
  it('answers exactly what arrived, spaces and all', () => {
    expect(required('main', 'branch', TOOL)).toBe('main');
    // Trimming is the caller's: only it knows whether the spaces matter.
    expect(required('  fix/kqueue  ', 'branch', TOOL)).toBe('  fix/kqueue  ');
  });

  it('refuses a blank one, or one that is not text, naming the tool and the field', () => {
    const said = 'Invalid list_sessions input: branch must be a non-empty string.';
    expect(() => required('', 'branch', TOOL)).toThrow(said);
    expect(() => required('   ', 'branch', TOOL)).toThrow(said);
    expect(() => required(undefined, 'branch', TOOL)).toThrow(said);
    expect(() => required(null, 'branch', TOOL)).toThrow(said);
    expect(() => required(7, 'branch', TOOL)).toThrow(said);
  });
});

describe('the text a tool may be given', () => {
  it('is nothing where the field was left out, and what was given otherwise', () => {
    expect(optional(undefined, 'session', TOOL)).toBeUndefined();
    expect(optional(null, 'session', TOOL)).toBeUndefined();
    // An empty string is a value here, not a missing one.
    expect(optional('', 'session', TOOL)).toBe('');
    expect(optional('  ', 'session', TOOL)).toBe('  ');
  });

  it('refuses a value that is not text', () => {
    expect(() => optional(7, 'session', TOOL)).toThrow('Invalid list_sessions input: session must be a string.');
    expect(() => optional(true, 'session', TOOL)).toThrow('Invalid list_sessions input: session must be a string.');
  });
});

describe('a yes-or-no a tool may be given', () => {
  it('is nothing where the field was left out, and the boolean otherwise', () => {
    expect(flag(undefined, 'unread', TOOL)).toBeUndefined();
    expect(flag(null, 'unread', TOOL)).toBeUndefined();
    expect(flag(true, 'unread', TOOL)).toBe(true);
    expect(flag(false, 'unread', TOOL)).toBe(false);
  });

  it('refuses a value that is not a boolean', () => {
    const said = 'Invalid list_sessions input: unread must be a boolean.';
    expect(() => flag('yes', 'unread', TOOL)).toThrow(said);
    expect(() => flag(1, 'unread', TOOL)).toThrow(said);
  });
});

describe('a timestamp a tool may be given', () => {
  it('is nothing where the field was left out, and milliseconds since the epoch otherwise', () => {
    expect(when(undefined, 'createdAfter', TOOL)).toBeUndefined();
    expect(when(null, 'createdAfter', TOOL)).toBeUndefined();
    const at = when('2026-09-13T12:00:00Z', 'createdAfter', TOOL);
    expect(new Date(at as number).toISOString()).toBe('2026-09-13T12:00:00.000Z');
  });

  it('refuses anything that is not an ISO-8601 timestamp', () => {
    const said = 'Invalid list_sessions input: createdAfter must be an ISO-8601 timestamp.';
    expect(() => when('yesterday', 'createdAfter', TOOL)).toThrow(said);
    // A number is not a string that parses, however it reads.
    expect(() => when(1789214400000, 'createdAfter', TOOL)).toThrow(said);
  });
});
