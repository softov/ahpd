import { loggerOf } from '@ahpd/sdk';
import { expect, it } from 'vitest';
import { pluginHost } from '../../sdk/src/plugins/plugins.js';
import { checkTunnelKind } from '../../sdk/src/plugins/validate.js';
import type { Alert, LoaderContext } from '../../sdk/src/types/plugin.js';
import type { Tunnel, TunnelReport } from '../../sdk/src/types/tunnels.js';
import { TUNNEL_PORT } from '../src/discovery.js';
import { devtunnelKind, NAME, OPERATIONS, SCHEMA } from '../src/kind.js';
import type { KindOptions } from '../src/kind.js';
import type { Service } from '../src/service.js';

/*
 * The kind as the host registers it: the form, the verbs, the system tunnel and
 * the settings a start reads from a record.
 *
 * A start here runs over a service that is a few arrays, so the settings are
 * checked where the kind reads them. What a start reaches of the SDK is in
 * `tunnel-devtunnel.test.ts`; this file is the declaration a client reads and
 * the host checks.
 */

/** The service of a case that starts nothing. */
const unreached = (): Service => ({
  add: async () => { throw new Error('this test starts no tunnel'); },
  access: async () => { throw new Error('this test starts no tunnel'); },
  replace: async () => { throw new Error('this test starts no tunnel'); },
  carry: () => { throw new Error('this test starts no tunnel'); },
  remove: async () => { throw new Error('this test starts no tunnel'); },
  restart: async () => { throw new Error('this test starts no tunnel'); },
  show: async () => { throw new Error('this test starts no tunnel'); },
  close: async () => { throw new Error('this test starts no tunnel'); },
});

/** A service that serves the port it is given, and says what it was asked. */
const serving = (): {
  service: Service;
  added: { connector: string; port: number; anonymous: boolean }[];
} => {
  const added: { connector: string; port: number; anonymous: boolean }[] = [];
  return {
    service: {
      add: async (connector, port, anonymous) => {
        added.push({ connector, port, anonymous });
        return { remote: { id: 'tunnel-id', labels: [] } };
      },
      access: async () => {},
      replace: async () => undefined,
      carry: () => {},
      remove: async () => {},
      restart: async () => {},
      show: async () => undefined,
      close: async () => {},
    },
    added,
  };
};

/** One record of the kind, as the host hands it over. */
const recordOf = (settings: Record<string, unknown>): Tunnel => ({
  id: 't1',
  kind: NAME,
  plugin: 'tunnel-devtunnel',
  purpose: 'person',
  enabled: true,
  settings,
});

/** The kind, the plugin host it is registered through, and the alerts it raised. */
const kindOf = (over: Partial<KindOptions> = {}) => {
  const alerts: Alert[] = [];
  const context: LoaderContext = {
    path: '/work', paths: ['/work'], version: '0.6.3', hostName: 'test', configDir: '/work', log: loggerOf(() => {}), say: () => {},
  };
  const { host } = pluginHost('tunnel', context, {
    alert: (alert) => { alerts.push(alert); },
  });
  const kind = devtunnelKind({
    plugin: host,
    service: unreached(),
    anonymous: false,
    keep: true,
    open: () => true,
    daemonPort: () => TUNNEL_PORT,
    guarded: () => false,
    ...over,
  });
  return { kind, alerts };
};

it('passes the registration check, with the connector mark, the port and anonymous off', () => {
  expect(() => { checkTunnelKind(kindOf().kind, 'tunnel-devtunnel'); }).not.toThrow();

  const properties = SCHEMA['properties'] as Record<string, Record<string, unknown>>;
  expect(properties['connector']).toMatchObject({ type: 'string', 'x-ahpd-connector': NAME });
  expect(properties['port']).toMatchObject({ type: 'number' });
  expect(properties['anonymous']).toMatchObject({ type: 'boolean', default: false });
  expect(SCHEMA['required']).toEqual(['connector', 'port']);
});

it('declares the person setting as `user:` and an id, which a bare id is not', () => {
  const properties = SCHEMA['properties'] as Record<string, Record<string, unknown>>;
  const person = properties['person'];
  expect(person).toMatchObject({ type: 'string', pattern: '^user:.+$', title: 'Person' });
  const pattern = new RegExp(String(person?.['pattern']), 'u');
  expect(pattern.test('user:ada')).toBe(true);
  expect(pattern.test('ada')).toBe(false);
  expect(pattern.test('user:')).toBe(false);
});

it('starts a record that names a person, and serves its port', async () => {
  const { service, added } = serving();
  const { kind } = kindOf({ service });
  const reports: TunnelReport[] = [];

  await kind.create(recordOf({ connector: 'mine', port: 9187, person: 'user:ada' }), (report) => { reports.push(report); });

  expect(added).toEqual([{ connector: 'mine', port: 9187, anonymous: false }]);
  expect(reports.at(-1)).toMatchObject({ status: 'running' });
});

it('refuses a record whose person is not `user:` and an id, and starts nothing', async () => {
  const { service, added } = serving();
  const { kind } = kindOf({ service });
  const reports: TunnelReport[] = [];

  await kind.create(recordOf({ connector: 'mine', port: 9187, person: 'ada' }), (report) => { reports.push(report); });

  expect(added).toEqual([]);
  expect(reports.at(-1)?.status).toBe('error');
  expect(reports.at(-1)?.error).toContain('person');
});

it('lists start, stop, restart and anonymous, and anonymous takes on', () => {
  expect(OPERATIONS.map((one) => one.id)).toEqual(['start', 'stop', 'restart', 'anonymous']);
  const anonymous = OPERATIONS.find((one) => one.id === 'anonymous');
  expect(anonymous?.input).toMatchObject({
    type: 'object',
    properties: { on: { type: 'boolean' } },
    required: ['on'],
  });
});

it('answers the system tunnel with its connector and the well-known port', async () => {
  const { kind } = kindOf({ connector: 'mine', anonymous: true });

  expect(await kind.system?.({ port: 9187 })).toEqual({
    connector: 'mine',
    port: TUNNEL_PORT,
    anonymous: true,
  });
});

it('answers the system tunnel with its person when one is set', async () => {
  const { kind } = kindOf({ connector: 'mine', anonymous: true, person: 'user:ada' });

  expect(await kind.system?.({ port: 9187 })).toEqual({
    connector: 'mine',
    port: TUNNEL_PORT,
    anonymous: true,
    person: 'user:ada',
  });
});

it('adds no system tunnel without a connector, and says what to set', async () => {
  const { kind, alerts } = kindOf();

  expect(await kind.system?.({ port: 9187 })).toBeUndefined();
  expect(alerts).toHaveLength(1);
  expect(alerts[0]?.level).toBe('warning');
  expect(alerts[0]?.text).toContain('`connector`');
  expect(alerts[0]?.text).toContain('Sign in to a devtunnel connector');
});
