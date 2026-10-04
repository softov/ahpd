import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { fileResources } from '../src/resources.js';
import { holds } from '../src/users.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import type { Grant, Users } from '../src/types/users.js';

/*
 * The one gate.
 *
 * Every command a client sends passes it once, and a host with no user
 * directory refuses nothing - which is the case most of these assert, because
 * it is the one every existing install is in.
 */

export const RECORD = { resource: 'ahpd://users', resource_name: 'ahpd users', authorization_servers: ['https://example.test'], required: false };

export let root: string;
export let file: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-gate-'));
  file = join(root, 'a.txt');
  writeFileSync(file, 'on disk');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

export const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

/** A peer that keeps what it was told, for the half that answers with a notification. */
export const watching = (): Peer & { seen: { method: string; params: Bag }[] } => {
  const seen: { method: string; params: Bag }[] = [];
  return {
    seen,
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

export type Bag = Record<string, any>;

/** Everything a terminal has said on its channel so far. */
const said = (p: ReturnType<typeof watching>, uri: string): string => p.seen
  .filter((one) => one.method === 'action' && one.params.channel === uri && one.params.action?.type === 'terminal/data')
  .map((one) => String(one.params.action.data)).join('');

/** Wait until the terminal has said it, so a negative can be asserted against a positive. */
export const until = async (p: ReturnType<typeof watching>, uri: string, text: string): Promise<string> => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (said(p, uri).includes(text)) return said(p, uri);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return said(p, uri);
};

/** A directory whose tokens are decided by hand, so a role is one array. */
/**
 * A person holding these grants, answered the way the directory answers.
 *
 * The gate asks for operations and the roles here are written as groups, so a
 * fixture that compared the strings would refuse most of what it is meant to
 * allow - `holds` is what makes a group cover an operation.
 */
export const can = (granted: readonly Grant[]) => (one: Grant) => holds(new Set(granted), one);

export const directory = (tokens: Record<string, Grant[]>): Users => ({
  resource: RECORD,
  verify: async (token) => {
    const held = tokens[token];
    return held === undefined ? undefined : { id: token, roles: ['r'], can: can(held) };
  },
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => '',
});

export const host = (extra: Partial<HostOptions> = {}) => createHost({
  path: root,
  agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
  resources: fileResources(),
  ...extra,
});

export const hello = (client: ReturnType<ReturnType<typeof createHost>['accept']>, clientId = 'probe') => client.handle({
  method: 'initialize',
  params: { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
});

export const signIn = (client: ReturnType<ReturnType<typeof createHost>['accept']>, token: string) => client.handle({
  method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token },
});

/** The refusal, or the result, whichever the host answered with. */
export const call = async (client: ReturnType<ReturnType<typeof createHost>['accept']>, method: string, params: Record<string, unknown>) =>
  client.handle({ method, params }).then(
    (result) => ({ result }),
    (error: { code: number; message: string; data?: unknown }) => error,
  );

/** A signed-in client whose refusals are kept, for the dispatch half of the gate. */
export const withRole = async (made: ReturnType<typeof host>, token: string) => {
  const seen = watching();
  const client = made.accept(seen);
  await hello(client, token); await signIn(client, token);
  const refused = () => seen.seen
    .filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
    .map((one) => `${String(one.params.channel)}: ${String(one.params.rejectionReason)}`);
  const send = async (channel: string, action: Bag) => {
    client.handle({ method: 'dispatchAction', params: { channel, action } });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { client, seen, refused, send };
};

/** A row a `claude` backend keeps on disk. */
export const onDisk = (id: string) => {
  const stamp = new Date(0).toISOString();
  return { id, title: 'On disk', createdAt: stamp, modifiedAt: stamp, workingDirectories: [`file://${root}`] };
};

/**
 * A `claude` backend whose catalogue lists `rows`, one row `disk` to begin
 * with, each with no turns, and counts how often it is asked.
 */
export const listingOne = () => {
  const counted = { lists: 0 };
  const rows = [onDisk('disk')];
  const agent = {
    ...echo({ path: root, pace: 0 }),
    provider: 'claude',
    displayName: 'Claude',
    list: async () => {
      counted.lists += 1;
      return [...rows];
    },
    transcript: async () => [],
  };
  return { agent, counted, rows };
};