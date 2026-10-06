import { describe, expect, it } from 'vitest';
import { SET, maskOption, maskValue } from '../src/commands/config.js';

/*
 * The mask every answer about a plugin's options goes through.
 *
 * `writeOnly` is a property of a schema, not of an option name, so these cases
 * are about the walk rather than about any one plugin: which keywords of a
 * schema it reaches, and what it does where a schema says nothing.
 */

const SECRET = { type: 'string', writeOnly: true };

describe('a value walked against the schema around it', () => {
  it('answers a marked property as set, and any other as it is', () => {
    const schema = { properties: { apiKey: SECRET, region: { type: 'string' } } };
    expect(maskValue(schema, { apiKey: 'k-1', region: 'eu' })).toEqual({ apiKey: SET, region: 'eu' });
  });

  it('is the same wherever in the value the mark sits', () => {
    const schema = { properties: { tools: { properties: { web: { properties: { brave: { properties: { apiKey: SECRET } } } } } } } };
    expect(maskValue(schema, { tools: { web: { brave: { apiKey: 'bs-1' } } } })).toEqual({ tools: { web: { brave: { apiKey: SET } } } });
  });

  it('reaches a property held by additionalProperties', () => {
    expect(maskValue({ additionalProperties: SECRET }, { anything: 'secret' })).toEqual({ anything: SET });
  });

  it('reaches a property whose name a pattern matches', () => {
    const schema = { patternProperties: { '^ANTHROPIC_': SECRET } };
    expect(maskValue(schema, { ANTHROPIC_API_KEY: 'sk-1', HOME: '/home/me' })).toEqual({ ANTHROPIC_API_KEY: SET, HOME: '/home/me' });
  });

  it('reaches every item of a list', () => {
    const schema = { properties: { keys: { items: SECRET } } };
    expect(maskValue(schema, { keys: ['k-1', 'k-2'] })).toEqual({ keys: [SET, SET] });
  });

  it('carries a value the schema does not describe', () => {
    const schema = { properties: { apiKey: SECRET } };
    expect(maskValue(schema, { adapter: { name: 'a model adapter' } })).toEqual({ adapter: { name: 'a model adapter' } });
  });

  it('answers every value as set when no schema was read', () => {
    expect(maskValue(undefined, { apiKey: 'k-1', region: 'eu' })).toEqual({ apiKey: SET, region: SET });
  });

  it('answers a reference as it is written, marked or not', () => {
    // A reference is a name and not a value, so marking the option it is written
    // for says nothing about it: what has to stay readable is where the value
    // comes from, and `<set>` would say only that there is one.
    const schema = { properties: { apiKey: SECRET, later: SECRET } };
    expect(maskValue(schema, { apiKey: { $secret: 'host:orders' }, later: { $secret: 'team:backend/reports' } }))
      .toEqual({ apiKey: { $secret: 'host:orders' }, later: { $secret: 'team:backend/reports' } });
    expect(maskValue(undefined, { apiKey: { $secret: 'host:orders' } })).toEqual({ apiKey: { $secret: 'host:orders' } });
    // An object beside the reference is a value of its own, and is masked as one.
    expect(maskValue(schema, { apiKey: { $secret: 'host:orders', note: 'k-1' } })).toEqual({ apiKey: SET });
  });
});

describe('one option of a plugin', () => {
  const schema = { properties: { apiKey: SECRET, region: { type: 'string' }, tools: { properties: { shell: { type: 'boolean' } } } } };

  it('answers a marked option as set, however deep its own value goes', () => {
    expect(maskOption(schema, 'apiKey', 'k-1')).toBe(SET);
    expect(maskOption(schema, 'tools', { shell: true })).toEqual({ shell: true });
  });

  it('is the whole value as set when no schema was read', () => {
    expect(maskOption(undefined, 'region', 'eu')).toBe(SET);
    expect(maskOption(undefined, 'tools', { shell: true })).toBe(SET);
  });

  it('answers a reference as it is written, with a schema and without one', () => {
    expect(maskOption(schema, 'apiKey', { $secret: 'host:orders' })).toEqual({ $secret: 'host:orders' });
    expect(maskOption(undefined, 'region', { $secret: 'host:orders' })).toEqual({ $secret: 'host:orders' });
  });
});

describe('the computer plugin', () => {
  /*
   * A machine need's value is the same variable the plugin's `env` beside it
   * holds, so it answers `<set>` wherever it is written: under the plugin's own
   * `needs` and under a profile's.
   */
  it('answers a need value as set, a reference as written, and a profile field as it is', async () => {
    const { optionsSchema } = await import('../../computer/src/plugin.js');
    const schema = optionsSchema as Record<string, unknown>;
    expect(maskOption(schema, 'needs', { anthropicKey: 'sk-1', other: { $secret: 'host:x' } }))
      .toEqual({ anthropicKey: SET, other: { $secret: 'host:x' } });
    expect(maskOption(schema, 'profiles', {
      claude: { image: 'node:22', needs: { anthropicKey: 'sk-2', other: { $secret: 'host:x' } } },
    })).toEqual({ claude: { image: 'node:22', needs: { anthropicKey: SET, other: { $secret: 'host:x' } } } });
    // A profile with no needs is left as written.
    expect(maskOption(schema, 'profiles', { plain: { image: 'debian' } })).toEqual({ plain: { image: 'debian' } });
  });
});