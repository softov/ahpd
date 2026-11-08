/*
 * What a key and a call say about themselves: one map, one set of bounds.
 *
 * The mint writes a key's meta and a proxy call writes its own, and both go
 * through `checkMeta`, so a case here is one every door refuses. `parseMeta`
 * reads the header's text, a JSON object as LiteLLM's.
 */

import { expect, it } from 'vitest';
import { checkMeta, parseMeta } from '../src/access/meta.js';
import { RpcError } from '../src/rpc.js';

/** The sentence a refusal carries, which is what a client and the log read. */
const refusal = (run: () => unknown): string => {
  try { run(); }
  catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe(-32602);
    return (error as Error).message;
  }
  throw new Error('nothing was refused');
};

it('accepts a name and a value at their limits, and refuses one past each', () => {
  const longestName = 'a'.repeat(64);
  const longestValue = 'x'.repeat(256);
  expect(checkMeta({ [longestName]: longestValue })).toEqual({ [longestName]: longestValue });

  expect(refusal(() => checkMeta({ ['a'.repeat(65)]: 'x' }))).toContain('is 1 to 64 characters');
  expect(refusal(() => checkMeta({ '': 'x' }))).toContain('is 1 to 64 characters');
  expect(refusal(() => checkMeta({ a: 'x'.repeat(257) }))).toContain('is 256 characters at most');
  // An empty value is a name with nothing after it, which is a value of zero.
  expect(checkMeta({ a: '' })).toEqual({ a: '' });
});

it('accepts 32 entries and refuses the thirty-third', () => {
  const entries = Object.fromEntries(Array.from({ length: 32 }, (_one, at) => [`k${String(at)}`, 'v']));
  expect(Object.keys(checkMeta(entries))).toHaveLength(32);
  expect(refusal(() => checkMeta({ ...entries, k32: 'v' }))).toBe('A meta names 32 entries at most, and that body names 33');
});

// A meta is LiteLLM's spend_logs_metadata, any names and string values
// (https://docs.litellm.ai/docs/proxy/cost_tracking).
it('takes a name and a value of any characters, and refuses a value that is not a string', () => {
  expect(checkMeta({ 'a b/é,c': 'x, y\nz' })).toEqual({ 'a b/é,c': 'x, y\nz' });
  expect(refusal(() => checkMeta({ a: 1 }))).toBe('A meta\'s a is a string, and that body has 1');
});

it('refuses a body that is not a map', () => {
  for (const body of [undefined, null, [], 'a=1', 3]) {
    expect(refusal(() => checkMeta(body))).toContain('A meta is a map of names to values');
  }
});

// LiteLLM's x-litellm-spend-logs-metadata header is a JSON object
// (https://docs.litellm.ai/docs/proxy/cost_tracking).
it('reads a JSON object of string values, and refuses text that is not JSON', () => {
  expect(parseMeta('{"a":"1","b":"two, three"}')).toEqual({ a: '1', b: 'two, three' });
  // Nothing named is no meta at all, which is what a client sending no header means.
  expect(parseMeta('  ')).toEqual({});

  expect(refusal(() => parseMeta('a=1,b=2'))).toBe('A meta is a JSON object of string values, and a=1,b=2 is not JSON');
  expect(refusal(() => parseMeta('["a"]'))).toContain('A meta is a map of names to values');
});

it('refuses what checkMeta refuses, so every door agrees', () => {
  expect(refusal(() => parseMeta(JSON.stringify({ a: 'y'.repeat(257) })))).toContain('is 256 characters at most');
  expect(refusal(() => parseMeta('{"a":1}'))).toBe('A meta\'s a is a string, and that body has 1');
  const many = Object.fromEntries(Array.from({ length: 33 }, (_one, at) => [`k${String(at)}`, 'v']));
  expect(refusal(() => parseMeta(JSON.stringify(many)))).toBe('A meta names 32 entries at most, and that body names 33');
});
