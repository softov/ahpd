import { describe, expect, it } from 'vitest';
import { asSpec } from '../packages/server/src/config.js';

/*
 * The one normaliser between a configuration file and a spec.
 *
 * A configuration file is JSON somebody typed, so `plugins` can hold anything
 * at all; this is where a typo is turned into nothing so the daemon can refuse
 * the start and name the entry rather than load a half-built plugin. It is
 * tested apart from `parse()` because the daemon domain records that no test
 * starts `main.ts`: the normaliser is the part with a decision in it.
 */

describe('asSpec', () => {
  it('passes a non-empty string through unchanged', () => {
    expect(asSpec('@ahpd/agent-cofold')).toBe('@ahpd/agent-cofold');
    expect(asSpec('./some/plugin.js')).toBe('./some/plugin.js');
  });

  it('accepts an object with a name, with or without options and enabled', () => {
    expect(asSpec({ name: 'x' })).toEqual({ name: 'x' });
    expect(asSpec({ name: 'x', options: { model: 'fast' } })).toEqual({ name: 'x', options: { model: 'fast' } });
    expect(asSpec({ name: 'x', enabled: false })).toEqual({ name: 'x', enabled: false });
    expect(asSpec({ name: 'x', options: {}, enabled: true })).toEqual({ name: 'x', options: {}, enabled: true });
  });

  it('returns nothing for an empty string, a number, or a missing or non-string name', () => {
    expect(asSpec('')).toBeUndefined();
    expect(asSpec('   ')).toBeUndefined();
    expect(asSpec(7)).toBeUndefined();
    expect(asSpec({})).toBeUndefined();
    expect(asSpec({ name: 7 })).toBeUndefined();
    expect(asSpec({ name: '' })).toBeUndefined();
  });

  it('returns nothing for the right name with the wrong kinds beside it', () => {
    expect(asSpec({ name: 'x', options: 'fast' })).toBeUndefined();
    expect(asSpec({ name: 'x', options: null })).toBeUndefined();
    expect(asSpec({ name: 'x', enabled: 'yes' })).toBeUndefined();
    expect(asSpec(null)).toBeUndefined();
    expect(asSpec(['x'])).toBeUndefined();
  });
});
