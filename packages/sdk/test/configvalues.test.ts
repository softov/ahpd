/*
 * Whether a stored config value is one its schema property still offers.
 *
 * The two things a session property says about a value: its JSON type, and
 * the fixed list it is one of.
 */

import { describe, expect, it } from 'vitest';
import { accepts } from '../src/configvalues.js';

describe('a config value against its property', () => {
  it('takes a value on the list and refuses one that is not', () => {
    const mode = { type: 'string', enum: ['default', 'plan'] };
    expect(accepts(mode, 'plan')).toBe(true);
    expect(accepts(mode, 'nope')).toBe(false);
  });

  it('refuses the wrong JSON type', () => {
    expect(accepts({ type: 'object' }, 'all')).toBe(false);
    expect(accepts({ type: 'object' }, [])).toBe(false);
    expect(accepts({ type: 'array' }, [{ shell: 'bash' }])).toBe(true);
    expect(accepts({ type: 'string' }, 3)).toBe(false);
    expect(accepts({ type: 'number' }, 3)).toBe(true);
    expect(accepts({ type: 'integer' }, 3.5)).toBe(false);
    expect(accepts({ type: ['string', 'null'] }, null)).toBe(true);
  });

  it('takes a value off a dynamic list, which is only its first page', () => {
    expect(accepts({ type: 'string', enum: ['computer://a'], enumDynamic: true }, 'computer://b')).toBe(true);
  });

  it('takes anything a property does not constrain, and nothing without a property', () => {
    expect(accepts({}, { any: 'thing' })).toBe(true);
    expect(accepts(undefined, 'x')).toBe(false);
  });
});
