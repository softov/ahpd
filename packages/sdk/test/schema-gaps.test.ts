/*
 * Where a schema a plugin gives the host names no value at all.
 *
 * A client draws a form from each schema, so a hole is a control it cannot
 * draw: an object that names none of its keys, an array that says nothing
 * about its items, or a field with no shape. A bare `{}` is the one schema
 * that names every JSON value, and is not a hole.
 */

import { loggerOf } from '../src/log.js';
import { describe, expect, it } from 'vitest';
import { gapLine, schemaGaps } from '../src/plugins/schemagaps.js';
import { pluginHost } from '../src/plugins/plugins.js';
import { sdkVersion } from '../src/version.js';
import type { Engine, LoaderContext } from '../src/index.js';

/** What a plugin is handed, without the YAML the daemon would give it. */
const context = (): LoaderContext => ({
  path: '/tmp/acme', paths: ['/tmp/acme'], version: sdkVersion(), hostName: 'test', configDir: '/tmp/acme', log: loggerOf(() => {}), say: () => {},
});

/** One engine with the schema a case gives it. */
const engine = (schema: Record<string, unknown>): Engine => ({
  name: 'acme', title: 'Acme', description: 'One engine.', schema,
  open: () => { throw new Error('not opened in this test'); },
});

describe('the gaps in one schema', () => {
  it('names an object with no properties and no value schema', () => {
    expect(schemaGaps({ type: 'object' })).toEqual([{ path: '', reason: 'object with no properties' }]);
    expect(schemaGaps({ type: 'object', properties: {} })).toEqual([{ path: '', reason: 'object with no properties' }]);
  });

  it('takes an object that names its properties, or a value schema', () => {
    expect(schemaGaps({ type: 'object', properties: { a: { type: 'string' } } })).toEqual([]);
    expect(schemaGaps({ type: 'object', additionalProperties: { type: 'string' } })).toEqual([]);
    expect(schemaGaps({ type: 'object', additionalProperties: {} })).toEqual([]);
  });

  it('names an array with no items', () => {
    expect(schemaGaps({ type: 'array' })).toEqual([{ path: '', reason: 'array with no items' }]);
    expect(schemaGaps({ type: 'array', items: { type: 'string' } })).toEqual([]);
  });

  it('names a field that says neither its type nor its value', () => {
    expect(schemaGaps({ description: 'nothing said about its shape' })).toEqual([{ path: '', reason: 'value with no type' }]);
    expect(schemaGaps({ writeOnly: true, secretAtUse: true })).toEqual([{ path: '', reason: 'value with no type' }]);
  });

  it('takes a field that names its type, its values or a union', () => {
    expect(schemaGaps({ type: 'string' })).toEqual([]);
    expect(schemaGaps({ type: ['string', 'null'] })).toEqual([]);
    expect(schemaGaps({ enum: ['a', 'b'] })).toEqual([]);
    expect(schemaGaps({ const: 'a' })).toEqual([]);
    expect(schemaGaps({ oneOf: [{ type: 'string' }, { type: 'null' }] })).toEqual([]);
    expect(schemaGaps({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toEqual([]);
  });

  it('takes a condition on the value around it, such as a field one kind requires', () => {
    expect(schemaGaps({
      type: 'object',
      properties: { kind: { type: 'string', enum: ['a', 'b'] }, key: { type: 'string' } },
      allOf: [{ if: { properties: { kind: { const: 'a' } } }, then: { required: ['key'] } }],
    })).toEqual([]);
  });

  it('takes an empty schema as any JSON value', () => {
    expect(schemaGaps({})).toEqual([]);
    expect(schemaGaps(undefined)).toEqual([]);
    expect(schemaGaps(true)).toEqual([]);
  });

  it('walks properties, the value schema of a map, and items', () => {
    const schema = {
      type: 'object',
      properties: {
        env: { type: 'object' },
        args: { type: 'array' },
        machine: {
          properties: {
            copy: { description: 'host paths' },
            env: { additionalProperties: { description: 'a variable' } },
          },
        },
      },
    };
    expect(schemaGaps(schema)).toEqual([
      { path: 'env', reason: 'object with no properties' },
      { path: 'args', reason: 'array with no items' },
      { path: 'machine.copy', reason: 'value with no type' },
      { path: 'machine.env.*', reason: 'value with no type' },
    ]);
  });

  it('walks each branch of a union, and the items of each', () => {
    const schema = {
      type: 'array',
      items: {
        oneOf: [
          { type: 'object' },
          { type: 'array' },
          { type: 'array', items: { type: 'object' } },
        ],
      },
    };
    expect(schemaGaps(schema)).toEqual([
      { path: 'items.oneOf[0]', reason: 'object with no properties' },
      { path: 'items.oneOf[1]', reason: 'array with no items' },
      { path: 'items.oneOf[2].items', reason: 'object with no properties' },
    ]);
  });

  it('finds every gap in one schema rather than stopping at the first', () => {
    expect(schemaGaps({ type: 'object', properties: { a: { type: 'array' }, b: { type: 'object' } } })).toHaveLength(2);
  });

  it('ends in a schema that holds itself, and still reports a node shared by two fields', () => {
    const node: Record<string, unknown> = { type: 'object', properties: { list: { type: 'array' } } };
    (node['properties'] as Record<string, unknown>)['child'] = node;
    expect(schemaGaps(node)).toEqual([{ path: 'list', reason: 'array with no items' }]);
    const shared = { type: 'object' };
    expect(schemaGaps({ type: 'object', properties: { a: shared, b: shared } })).toHaveLength(2);
  });
});

describe('the problem line one gap is said in', () => {
  it('names the plugin, the place and the path', () => {
    expect(gapLine('agent-claude', 'engine claude', { path: 'env', reason: 'object with no properties' }))
      .toBe('agent-claude: engine claude env: object with no properties');
  });

  it('leaves the path off when the schema itself is the hole', () => {
    expect(gapLine('acme', 'trigger start', { path: '', reason: 'array with no items' }))
      .toBe('acme: trigger start: array with no items');
  });
});

describe('a registration with a gap', () => {
  it('loads, and says one problem line naming the plugin and the path', () => {
    const lines: string[] = [];
    const recorded = pluginHost('acme', context(), { alert: (alert) => { lines.push(alert.text); } });
    recorded.host.registerEngine(engine({ type: 'object', properties: { env: { type: 'object' } } }));

    expect(recorded.contribution.engines?.['acme']).toBeDefined();
    expect(lines).toEqual(['acme: engine acme env: object with no properties']);
  });

  it('says a session config key and a capability input with their own places', () => {
    const lines: string[] = [];
    const recorded = pluginHost('acme', context(), { alert: (alert) => { lines.push(alert.text); } });
    recorded.host.registerSessionConfig('mode', { type: 'object' });
    recorded.host.registerAdapter({
      name: 'acme', title: 'Acme', description: 'One adapter.',
      schema: { type: 'object', properties: {} },
      capabilities: [{
        type: 'action', name: 'send', title: 'Send', description: 'Sends.', input: { type: 'array' },
      }],
      open: () => undefined,
      run: async () => ({ result: 'ok' }),
    });

    expect(lines).toEqual([
      'acme: session config mode: object with no properties',
      'acme: adapter acme: object with no properties',
      'acme: adapter acme capability send input: array with no items',
    ]);
  });

  it('loads an adapter whose vault field says writeOnly alone, and says to mark it secret', () => {
    const lines: string[] = [];
    const recorded = pluginHost('acme', context(), { alert: (alert) => { lines.push(alert.text); } });
    recorded.host.registerAdapter({
      name: 'acme', title: 'Acme', description: 'One adapter.',
      schema: { type: 'object', properties: { apiKey: { type: 'string', writeOnly: true }, region: { type: 'string' } } },
      capabilities: [],
      open: () => undefined,
    });

    expect(recorded.contribution.adapters['acme']).toBeDefined();
    expect(lines).toEqual(['acme: adapter acme apiKey: writeOnly kept in the vault; mark it secret']);
  });

  it('says a nested writeOnly field of an adapter stays in the record, masked', () => {
    const lines: string[] = [];
    const recorded = pluginHost('acme', context(), { alert: (alert) => { lines.push(alert.text); } });
    recorded.host.registerAdapter({
      name: 'acme', title: 'Acme', description: 'One adapter.',
      schema: {
        type: 'object',
        properties: {
          apiKey: { type: 'string', writeOnly: true },
          auth: { type: 'object', properties: { token: { type: 'string', writeOnly: true } } },
        },
      },
      capabilities: [],
      open: () => undefined,
    });

    expect(lines).toEqual([
      'acme: adapter acme apiKey: writeOnly kept in the vault; mark it secret',
      'acme: adapter acme auth.token: writeOnly below the top stays in the record, masked; only a top-level field is kept in the vault',
    ]);
  });

  it('says nothing about a vault field that says secret, at the top or under env', () => {
    const lines: string[] = [];
    const recorded = pluginHost('acme', context(), { alert: (alert) => { lines.push(alert.text); } });
    recorded.host.registerEngine({
      ...engine({
        type: 'object',
        properties: {
          apiKey: { type: 'string', secret: true },
          env: { type: 'object', additionalProperties: { type: 'string', secret: true } },
          plain: { type: 'string', writeOnly: true, secret: false },
        },
      }),
      keyVariables: ['TOKEN'],
    });

    expect(lines).toEqual([]);
  });

  it('names each path a schema marks writeOnly alone, at any depth', () => {
    const lines: string[] = [];
    const recorded = pluginHost('acme', context(), { alert: (alert) => { lines.push(alert.text); } });
    recorded.host.registerEngine(engine({
      type: 'object',
      properties: {
        apiKey: { type: 'string', writeOnly: true },
        env: { type: 'object', additionalProperties: { type: 'string', writeOnly: true } },
        logins: { type: 'array', items: { type: 'object', properties: { token: { type: 'string', writeOnly: true } } } },
      },
    }));

    expect(lines).toEqual([
      'acme: engine acme apiKey: writeOnly kept in the vault; mark it secret',
      'acme: engine acme env.*: writeOnly kept in the vault; mark it secret',
      'acme: engine acme logins.items.token: writeOnly kept in the vault; mark it secret',
    ]);
  });
});
