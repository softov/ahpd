import { describe, expect, it } from 'vitest';
import { bag, isRecord, ownerOf, reason, str, strings } from '../src/values.js';

/*
 * The readers every package had its own copy of.
 *
 * The cases are the corners the copies disagreed on: whether a list is an
 * object, whether a non-array has any strings in it, and whether a refusal
 * with no id is a reference at all.
 */

describe('isRecord', () => {
  it('is an object with named fields', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord({})).toBe(true);
  });

  it('is not a list, a null, or anything else', () => {
    expect(isRecord([1])).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(3)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('bag', () => {
  it('answers the object it was given', () => {
    expect(bag({ a: 1 })).toEqual({ a: 1 });
  });

  it('answers an empty object for a list, so a list is never read as one with fields', () => {
    expect(bag([1])).toEqual({});
  });

  it('answers an empty object for anything that is not one', () => {
    expect(bag(null)).toEqual({});
    expect(bag('x')).toEqual({});
    expect(bag(3)).toEqual({});
    expect(bag(undefined)).toEqual({});
  });
});

describe('str', () => {
  it('answers a string as it is', () => {
    expect(str('x')).toBe('x');
    expect(str('')).toBe('');
  });

  it('answers nothing for anything else', () => {
    expect(str(3)).toBeUndefined();
    expect(str(null)).toBeUndefined();
    expect(str(['x'])).toBeUndefined();
  });
});

describe('strings', () => {
  it('answers the strings in a list, whatever else is in there', () => {
    expect(strings(['a', 1, 'b'])).toEqual(['a', 'b']);
  });

  it('answers an empty list for anything that is not a list', () => {
    expect(strings('a')).toEqual([]);
    expect(strings({ 0: 'a' })).toEqual([]);
    expect(strings(null)).toEqual([]);
    expect(strings(undefined)).toEqual([]);
  });
});

describe('reason', () => {
  it('answers an error\'s message', () => {
    expect(reason(new Error('x'))).toBe('x');
  });

  it('answers anything else as text', () => {
    expect(reason(3)).toBe('3');
    expect(reason('x')).toBe('x');
    expect(reason(undefined)).toBe('undefined');
  });
});

describe('ownerOf', () => {
  it('answers a reference of one of the four kinds', () => {
    expect(ownerOf('team:a')).toBe('team:a');
    expect(ownerOf('user:ana')).toBe('user:ana');
    expect(ownerOf('project:team:one')).toBe('project:team:one');
    expect(ownerOf('root:host')).toBe('root:host');
  });

  it('answers nothing for a kind it does not name, or for no id', () => {
    expect(ownerOf('team:')).toBeUndefined();
    expect(ownerOf('teams:a')).toBeUndefined();
    expect(ownerOf(':a')).toBeUndefined();
    expect(ownerOf('a')).toBeUndefined();
    expect(ownerOf(3)).toBeUndefined();
    expect(ownerOf(undefined)).toBeUndefined();
  });
});
