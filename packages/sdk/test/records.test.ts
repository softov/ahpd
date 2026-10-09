import { describe, expect, it } from 'vitest';
import { RpcError } from '../src/rpc.js';
import { asFile, jsonBody, splitResource } from '../src/records.js';
import type { Write } from '../src/types/resources.js';

/*
 * The parts every record scheme and computer and usage share.
 *
 * The cases are the corners: a URI that names no record, one with a leaf under
 * it and one that asked something, and a body that is empty, is a list, or is
 * not JSON at all.
 */

/** One write, as a client sends it. */
const body = (data: string, encoding: 'utf-8' | 'base64' = 'utf-8'): Write => ({ data, encoding });

/** What a call refused with, so the code and the sentence are both checked. */
const refused = (call: () => unknown): RpcError => {
  try {
    call();
  }
  catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }
  throw new Error('the call was not refused');
};

describe('splitResource', () => {
  it('reads the id, the leaf and the query', () => {
    expect(splitResource('x://', 'x')).toEqual({ id: '', leaf: '', query: '' });
    expect(splitResource('x://a', 'x')).toEqual({ id: 'a', leaf: '', query: '' });
    expect(splitResource('x://a/b', 'x')).toEqual({ id: 'a', leaf: 'b', query: '' });
    expect(splitResource('x://a/b/c', 'x')).toEqual({ id: 'a', leaf: 'b/c', query: '' });
    expect(splitResource('x://a?q=1', 'x')).toEqual({ id: 'a', leaf: '', query: 'q=1' });
    expect(splitResource('x://a/b?q=1', 'x')).toEqual({ id: 'a', leaf: 'b', query: 'q=1' });
  });

  it('refuses a URI of another scheme, or one with no authority', () => {
    const wrong = refused(() => splitResource('y://a', 'x'));
    expect(wrong.code).toBe(-32602);
    expect(wrong.message).toBe('y://a is not a x: URI');
    expect(refused(() => splitResource('a', 'x')).code).toBe(-32602);
    expect(refused(() => splitResource('x:a', 'x')).code).toBe(-32602);
  });
});

describe('jsonBody', () => {
  it('reads a JSON object as it is', () => {
    expect(jsonBody(body('{"a":1}'), 'policy')).toEqual({ a: 1 });
  });

  it('reads an empty body as an empty object', () => {
    expect(jsonBody(body(''), 'policy')).toEqual({});
  });

  it('reads a base64 body as the text it carries', () => {
    const encoded = Buffer.from('{"a":1}', 'utf8').toString('base64');
    expect(jsonBody(body(encoded, 'base64'), 'policy')).toEqual({ a: 1 });
  });

  it('refuses a list, naming what the body was for', () => {
    const listed = refused(() => jsonBody(body('[]'), 'policy'));
    expect(listed.code).toBe(-32602);
    expect(listed.message).toBe('A policy is made from a JSON object, and that body is not one');
  });

  it('refuses a body that is not JSON, naming what it was for', () => {
    const not = refused(() => jsonBody(body('nope'), 'policy'));
    expect(not.code).toBe(-32602);
    expect(not.message).toBe('A policy is made from a JSON object; that body is not one');
    expect(refused(() => jsonBody(body('3'), 'policy')).code).toBe(-32602);
    expect(refused(() => jsonBody(body('null'), 'policy')).code).toBe(-32602);
  });
});

describe('asFile', () => {
  it('is a JSON file in UTF-8', () => {
    expect(asFile('{"a":1}')).toEqual({ data: '{"a":1}', encoding: 'utf-8', contentType: 'application/json' });
  });
});
