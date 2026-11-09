import { loggerOf } from '../src/log.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { fileUsers } from '../src/access/users.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostEvent } from '../src/types/events.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Users } from '../src/types/users.js';

/*
 * `users_changed`: the users file, watched while a plugin listens.
 *
 * A real file in a fresh folder, a host with one plugin subscribed, and the
 * two ways the file changes - a person's editor and the host's own write.
 */

let root = '';
let path = '';
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-users-changed-'));
  path = join(root, 'users.json');
  writeFileSync(path, JSON.stringify({ roles: {}, users: [{ id: 'ana', roles: ['admin'] }] }));
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const wait = async (ms: number): Promise<void> => { await new Promise((r) => { setTimeout(r, ms); }); };

const context = (): LoaderContext => ({ path: root, paths: [root], version: sdkVersion(), hostName: 'test', configDir: root, log: loggerOf(() => {}), say: () => {} });

/** A host over `users`, with one plugin that keeps what it heard. */
function listening(users: Users, listen = true) {
  const seen: HostEvent[] = [];
  const { host: plugin, contribution } = pluginHost('probe', context());
  if (listen) plugin.on('users_changed', (event) => { seen.push(event); });
  const { options } = foldHostOptions({ path: root, agents: [echo({ path: root, pace: 0 })], users }, [contribution]);
  return { seen, host: createHost(options) };
}

it('a hand edit of the file is one users_changed', async () => {
  const { seen, host } = listening(fileUsers({ path }));
  // Let the watch settle in before the edit.
  await wait(50);
  writeFileSync(path, JSON.stringify({ roles: {}, users: [{ id: 'ana', roles: ['admin'] }, { id: 'bo', roles: [] }] }));
  await wait(400);
  expect(seen).toEqual([{ type: 'users_changed' }]);
  await host.close();
});

it('a write this host makes is one users_changed', async () => {
  const users = fileUsers({ path });
  const { seen, host } = listening(users);
  await wait(50);
  await users.add('bo', []);
  await wait(400);
  expect(seen).toEqual([{ type: 'users_changed' }]);
  await host.close();
});

it('a closed host hears no more changes', async () => {
  const users = fileUsers({ path });
  const { seen, host } = listening(users);
  await host.close();
  await users.add('bo', []);
  writeFileSync(path, JSON.stringify({ roles: {}, users: [] }));
  await wait(400);
  expect(seen).toEqual([]);
});

it('a host nobody listens on opens no watch', async () => {
  let opened = 0;
  const users = fileUsers({ path });
  const counted: Users = { ...users, resource: users.resource, watch: (onChange) => { opened += 1; return users.watch!(onChange); } };
  const { host } = listening(counted, false);
  expect(opened).toBe(0);
  await host.close();
  const heard = listening(counted);
  expect(opened).toBe(1);
  await heard.host.close();
});
