import { posix } from '../../../tools/posix.ts';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { fileResources } from '../../sdk/src/resources/resources.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { closeAll, keeping } from './support/closing.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { Vault } from '../../sdk/src/types/vault.js';
import { agentAddressOf, labelsOfNotes, proxmoxRuntime } from '../src/proxmox.js';
import type { ProxmoxOptions } from '../src/proxmox.js';
import { keygenWith } from '../src/keys.js';
import type { MachineSpec } from '../src/runtime.js';

/*
 * Virtual machines on a Proxmox node, made through a fake of its API served
 * over TLS on a local port, and reached through the scripted `ssh`.
 *
 * The VM a test reaches is this host, as it is for libvirt: what is checked is
 * the calls the runtime makes, what it reads back, and that the token's
 * secret is in nothing it says.
 */

const SSH = fileURLToPath(new URL('./fixtures/ssh.mjs', import.meta.url));
const KEYGEN = fileURLToPath(new URL('./fixtures/ssh-keygen.mjs', import.meta.url));
const LABEL = 'ahpd.computer=1';
const NODE = 'pve';
const TOKEN = 'root@pam!ahpd';
const SECRET = 'c0ffee00-1111-2222-3333-secretsecret';
const TEMPLATE = 'ahpd-template';
const ADDRESS = '10.20.0.7';

interface Vm {
  name: string;
  template: 0 | 1;
  status: 'running' | 'stopped';
  qmpstatus: 'running' | 'paused' | 'stopped';
  config: Record<string, string>;
}

/** What the fake holds, and every call it was given with the form it was sent. */
const api = {
  vms: new Map<number, Vm>(),
  calls: [] as { method: string; path: string; body: Record<string, string> }[],
  secret: SECRET,
  tasks: 0,
};

let server: Server | undefined;
let url = '';
let ca = '';
let caFile = '';
let certs: string | undefined;

/** A certificate for 127.0.0.1, made once and signed by itself, which `ca` is pointed at. */
beforeAll(async () => {
  if (!posix) return;
  certs = mkdtempSync(join(tmpdir(), 'ahpd-proxmox-tls-'));
  const [key, cert] = [join(certs, 'key.pem'), join(certs, 'cert.pem')];
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost',
    '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
  ], { stdio: 'ignore' });
  ca = readFileSync(cert, 'utf8');
  caFile = cert;
  server = createServer({ key: readFileSync(key), cert: ca }, (request, response) => { void answer(request, response); });
  await new Promise<void>((resolve) => { server?.listen(0, '127.0.0.1', resolve); });
  const at = server.address();
  url = `https://127.0.0.1:${String(typeof at === 'object' && at !== null ? at.port : 0)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => { if (server === undefined) resolve(); else server.close(() => { resolve(); }); });
  if (certs !== undefined) rmSync(certs, { recursive: true, force: true });
});

/** A temporary directory removed after the test that made it. */
let loose: string | undefined;
afterEach(async () => {
  await closeAll();
  if (loose !== undefined) rmSync(loose, { recursive: true, force: true });
  loose = undefined;
  api.vms.clear();
  api.calls.length = 0;
  api.secret = SECRET;
});

const dir = (): string => (loose ??= mkdtempSync(join(tmpdir(), 'ahpd-proxmox-')));
const sshLog = (): string => join(dir(), 'ssh.jsonl');

const send = (response: ServerResponse, code: number, data: unknown, message?: string): void => {
  response.writeHead(code, message ?? (code === 200 ? 'OK' : 'error'), { 'content-type': 'application/json' });
  response.end(JSON.stringify(code === 200 ? { data } : { data: null, ...(data === undefined ? {} : { errors: data }) }));
};

/** A task that has already ended, as every one the fake starts has. */
const task = (what: string, vmid: number): string => `UPID:${NODE}:0000${String(api.tasks += 1)}:${what}:${String(vmid)}:${TOKEN}:`;

/** The fake API: the calls the runtime makes, and Proxmox's own answers to them. */
const answer = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
  let text = '';
  for await (const chunk of request) text += String(chunk);
  const method = request.method ?? 'GET';
  const whole = new URL(request.url ?? '/', 'https://fake');
  const path = whole.pathname.replace(/^\/api2\/json/, '');
  const body = Object.fromEntries(new URLSearchParams(text));
  api.calls.push({ method, path: `${path}${whole.search}`, body });
  if (request.headers.authorization !== `PVEAPIToken=${TOKEN}=${api.secret}`) {
    send(response, 401, undefined, 'invalid token value!');
    return;
  }
  if (method === 'GET' && path === '/cluster/nextid') {
    // The lowest id from 100 that no VM holds, as Proxmox answers it.
    let next = 100;
    while (api.vms.has(next)) next += 1;
    send(response, 200, String(next));
    return;
  }
  if (method === 'GET' && path === '/cluster/resources') {
    send(response, 200, [...api.vms].map(([vmid, one]) => ({
      vmid, name: one.name, node: NODE, status: one.status, template: one.template, ...(one.config.tags === undefined ? {} : { tags: one.config.tags }),
    })));
    return;
  }
  const taskStatus = new RegExp(`^/nodes/${NODE}/tasks/([^/]+)/status$`).exec(path);
  if (method === 'GET' && taskStatus !== null) {
    send(response, 200, { status: 'stopped', exitstatus: 'OK' });
    return;
  }
  const held = new RegExp(`^/nodes/${NODE}/qemu/(\\d+)(/.*)?$`).exec(path);
  const vmid = held === null ? 0 : Number(held[1]);
  const one = api.vms.get(vmid);
  if (held === null || one === undefined) {
    send(response, 500, { vmid: `Configuration file 'nodes/${NODE}/qemu-server/${String(vmid)}.conf' does not exist` });
    return;
  }
  const rest = held[2] ?? '';
  if (method === 'POST' && rest === '/clone') {
    if (one.template !== 1) { send(response, 500, { vmid: 'not a template' }); return; }
    const newid = Number(body.newid);
    if (api.vms.has(newid)) { send(response, 500, { newid: `VM ${String(newid)} already exists` }); return; }
    const { template: _template, ...config } = one.config;
    api.vms.set(newid, { name: body.name as string, template: 0, status: 'stopped', qmpstatus: 'stopped', config: { ...config } });
    send(response, 200, task('qmclone', newid));
    return;
  }
  if (method === 'PUT' && rest === '/config') {
    Object.assign(one.config, body);
    send(response, 200, null);
    return;
  }
  if (method === 'GET' && rest === '/config') {
    send(response, 200, one.config);
    return;
  }
  if (method === 'GET' && rest === '/status/current') {
    send(response, 200, { status: one.status, qmpstatus: one.qmpstatus, vmid });
    return;
  }
  const verb = /^\/status\/(\w+)$/.exec(rest)?.[1];
  if (method === 'POST' && verb !== undefined) {
    if (verb === 'start' || verb === 'resume' || verb === 'reboot') Object.assign(one, { status: 'running', qmpstatus: 'running' });
    else if (verb === 'suspend') Object.assign(one, { qmpstatus: 'paused' });
    else Object.assign(one, { status: 'stopped', qmpstatus: 'stopped' });
    send(response, 200, task(`qm${verb}`, vmid));
    return;
  }
  if (method === 'GET' && rest === '/agent/network-get-interfaces') {
    if (one.status !== 'running') { send(response, 500, undefined, 'VM is not running'); return; }
    send(response, 200, { result: [
      { name: 'lo', 'ip-addresses': [{ 'ip-address-type': 'ipv4', 'ip-address': '127.0.0.1' }] },
      { name: 'eth0', 'ip-addresses': [{ 'ip-address-type': 'ipv6', 'ip-address': 'fe80::1' }, { 'ip-address-type': 'ipv4', 'ip-address': ADDRESS }] },
    ] });
    return;
  }
  if (method === 'POST' && rest === '/template') {
    one.template = 1;
    one.config.template = '1';
    send(response, 200, task('qmtemplate', vmid));
    return;
  }
  if (method === 'DELETE' && rest === '') {
    if (one.status !== 'stopped') { send(response, 500, undefined, `VM ${String(vmid)} is running - destroy failed`); return; }
    api.vms.delete(vmid);
    send(response, 200, task('qmdestroy', vmid));
    return;
  }
  send(response, 501, undefined, `Method '${method} ${path}' not implemented`);
};

/** A node that holds the template, and the VMs given beside it. */
const node = (vms: Record<number, Vm> = {}): void => {
  api.vms.set(9000, { name: TEMPLATE, template: 1, status: 'stopped', qmpstatus: 'stopped', config: { template: '1', agent: '1' } });
  for (const [vmid, one] of Object.entries(vms)) api.vms.set(Number(vmid), one);
};

/** The VM called `name`, as the fake holds it. */
const vmCalled = (name: string): Vm | undefined => [...api.vms.values()].find((one) => one.name === name);

/**
 * A `cloud-init` the VM answers with, which is this host's: the scripted
 * `ssh` runs `cloud-init status --wait` here, where there is none.
 */
const cloudInit = (): string => {
  const bin = join(dir(), 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'cloud-init'), '#!/bin/sh\necho "status: done"\nexit 0\n');
  chmodSync(join(bin, 'cloud-init'), 0o755);
  writeFileSync(join(bin, 'sudo'), '#!/bin/sh\nexec "$@"\n');
  chmodSync(join(bin, 'sudo'), 0o755);
  // The packages a template is given go nowhere here.
  writeFileSync(join(bin, 'apt-get'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(bin, 'apt-get'), 0o755);
  return bin;
};

const lines: string[] = [];

/** A runtime over the fake, with `ca` pointed at its certificate. */
const runtime = (more: Omit<Partial<ProxmoxOptions>, 'template'> & { template?: string | undefined } = {}) => {
  node();
  lines.length = 0;
  const { template, ...rest } = { template: TEMPLATE, ...more };
  return proxmoxRuntime({
    url,
    tokenId: TOKEN,
    secret: async () => SECRET,
    node: NODE,
    storage: 'local-lvm',
    bridge: 'vmbr0',
    ...(template === undefined ? {} : { template }),
    ca,
    ssh: { command: process.execPath, args: [SSH], env: { SSH_FAKE_LOG: sshLog(), PATH: `${cloudInit()}${delimiter}${process.env.PATH ?? ''}` } },
    profiles: { pve: { server: NODE, box: { destination: 'ops@jump', port: '2222' } } },
    label: LABEL,
    configDir: join(dir(), 'config'),
    keygen: keygenWith(process.execPath, [KEYGEN]),
    hostId: 'host-a',
    waits: { boot: 2_000, ready: 2_000, every: 10, shutdown: 200 },
    log: (line) => { lines.push(line); },
    ...rest,
  });
};

const spec = (more: Partial<MachineSpec> = {}): MachineSpec => ({ name: 'vm-1', label: LABEL, profile: 'pve', ...more });

const calls = (): string[] => api.calls.map((one) => `${one.method} ${one.path}`);
const callsTo = (method: string, end: string) => api.calls.filter((one) => one.method === method && one.path.endsWith(end));
const ssh = (): string[][] => (existsSync(sshLog())
  ? readFileSync(sshLog(), 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line) as string[])
  : []);

it('reads what the API says: notes that hold labels, and the guest agent\'s address', () => {
  expect(labelsOfNotes('{"ahpd.owner":"user:ana","n":3}')).toEqual({ 'ahpd.owner': 'user:ana' });
  expect(labelsOfNotes('a note a person wrote')).toBeUndefined();
  expect(labelsOfNotes(undefined)).toBeUndefined();
  expect(agentAddressOf({ result: [{ 'ip-addresses': [{ 'ip-address-type': 'ipv4', 'ip-address': '127.0.0.1' }] }] })).toBeUndefined();
  expect(agentAddressOf({ result: [{ 'ip-addresses': [{ 'ip-address-type': 'ipv4', 'ip-address': '10.0.0.2' }] }] })).toBe('10.0.0.2');
});

it.skipIf(!posix)('makes a linked clone of the template, records it in its notes, and lists it with its owner', async () => {
  const vms = runtime();
  const made = await vms.run(spec({ agents: ['echo'], session: 's1', owner: 'user:ana', team: 'backend', cpus: '1.5', memory: '4g' }));
  expect(made).toMatchObject({ id: 'vm-1', image: TEMPLATE, status: 'running' });

  const [clone] = callsTo('POST', '/qemu/9000/clone');
  expect(clone?.body).toEqual({ newid: '100', name: 'vm-1', full: '0' });
  const config = callsTo('PUT', '/qemu/100/config')[0]?.body ?? {};
  expect(config).toMatchObject({ ciuser: 'ahpd', ipconfig0: 'ip=dhcp', tags: 'ahpd', agent: '1', net0: 'virtio,bridge=vmbr0', cores: '2', memory: '4096' });
  expect(decodeURIComponent(config.sshkeys ?? '')).toContain('AAAAC3NzaC1lZDI1NTE5AAAAIFixture');
  expect(JSON.parse(config.description ?? '{}')).toMatchObject({ 'ahpd.owner': 'user:ana', 'ahpd.host': 'host-a', 'ahpd.profile': 'pve' });
  expect(calls()).toContain('POST /nodes/pve/qemu/100/status/start');

  expect(await vms.list()).toEqual([expect.objectContaining({
    id: 'vm-1', image: TEMPLATE, status: 'running', agents: ['echo'], session: 's1', host: 'host-a', owner: 'user:ana', team: 'backend',
  })]);
  expect(await vms.state('vm-1')).toBe('running');
  expect(await vms.owner('vm-1')).toEqual({ owner: 'user:ana', team: 'backend' });

  // Reached at the guest agent's address, as its own login, through the jump box.
  expect(ssh().at(-1)).toEqual(expect.arrayContaining(['-J', 'ops@jump:2222', `ahpd@${ADDRESS}`]));
});

it.skipIf(!posix)('lists only VMs tagged ahpd that carry this host\'s label', async () => {
  const vms = runtime();
  const ours = JSON.stringify({ 'ahpd.computer': '1', 'ahpd.host': 'host-a', 'ahpd.created': '2026-10-30T00:00:00.000Z' });
  node({
    101: { name: 'vm-a', template: 0, status: 'stopped', qmpstatus: 'stopped', config: { tags: 'ahpd', description: ours } },
    102: { name: 'vm-b', template: 0, status: 'running', qmpstatus: 'running', config: { tags: 'ahpd', description: JSON.stringify({ 'ahpd.computer': '1', 'ahpd.host': 'host-b' }) } },
    103: { name: 'pc-02', template: 0, status: 'running', qmpstatus: 'running', config: { description: ours } },
  });
  expect(await vms.list()).toEqual([expect.objectContaining({ id: 'vm-a', status: 'stopped', created: '2026-10-30T00:00:00.000Z' })]);
  await expect(vms.remove('pc-02')).rejects.toThrow(/there is no proxmox machine called pc-02/);
  expect(vmCalled('pc-02')).toBeDefined();
});

it.skipIf(!posix)('suspends and resumes a VM, and removes it with its disks', async () => {
  const vms = runtime();
  await vms.run(spec());
  expect(vms.suspends?.('vm-1')).toBe(true);
  await vms.suspend?.('vm-1');
  expect(await vms.state('vm-1')).toBe('suspended');
  await expect(vms.suspend?.('vm-1')).rejects.toThrow(/vm-1 is paused, so it cannot be suspended/);
  await vms.resume?.('vm-1');
  expect(await vms.state('vm-1')).toBe('running');
  await vms.stop('vm-1');
  expect(await vms.state('vm-1')).toBe('stopped');
  await vms.start('vm-1');

  await vms.remove('vm-1');
  expect(calls()).toContain('POST /nodes/pve/qemu/100/status/stop');
  expect(calls()).toContain('DELETE /nodes/pve/qemu/100?purge=1&destroy-unreferenced-disks=1');
  expect(vmCalled('vm-1')).toBeUndefined();
  expect(vmCalled(TEMPLATE)).toBeDefined();
  expect(await vms.list()).toEqual([]);
});

it.skipIf(!posix)('builds a template from the image as a full clone, and keeps it as a template', async () => {
  const vms = runtime({ template: undefined, image: 'debian-13-cloud', parts: { joined: async () => 'sha256:abc', into: async () => {} } });
  api.vms.set(9001, { name: 'debian-13-cloud', template: 1, status: 'stopped', qmpstatus: 'stopped', config: { template: '1' } });
  await vms.run(spec());
  const [helper] = callsTo('POST', '/qemu/9001/clone');
  expect(helper?.body).toMatchObject({ full: '1', storage: 'local-lvm' });
  const built = [...api.vms.values()].find((one) => one.template === 1 && one.name !== TEMPLATE && one.name !== 'debian-13-cloud');
  expect(built).toBeDefined();
  // The packages a template needs go in over ssh, since Proxmox's cloud-init takes none.
  expect(ssh().some((one) => one.some((arg) => arg.includes('apt-get')))).toBe(true);
  expect(vmCalled('vm-1')).toMatchObject({ status: 'running' });
});

it.skipIf(!posix)('says a refused token is refused, without its secret', async () => {
  const vms = runtime({ secret: async () => 'wrong-secret-value' });
  const refused = await vms.run(spec()).then(() => undefined, (error: unknown) => error as Error);
  expect(refused).toBeInstanceOf(Error);
  expect(refused?.message).toMatch(/refused the API token root@pam!ahpd: invalid token value!/);
  expect(refused?.message).not.toContain('wrong-secret-value');
  await expect(vms.list()).rejects.toThrow(/refused the API token/);
  expect(lines.join('\n')).not.toContain('wrong-secret-value');
  expect(api.vms.size).toBe(1);
});

/** A vault holding `values` and nothing else. */
const holding = (values: Record<string, string>): Vault => ({
  get: async (name) => values[name],
  set: async () => {},
  delete: async () => false,
  list: async () => Object.keys(values),
});

/** The plugin, loaded with one Proxmox profile and the vault given, over the fixtures. */
const load = async (vault: Vault) => {
  node();
  const logged: string[] = [];
  const base: HostOptions = { path: '/tmp/computer-proxmox', hostName: 'box.local', agents: [], resources: fileResources(), vault };
  const result = await loadPlugins(
    [{
      name: './packages/computer/src/index.ts',
      options: {
        command: process.execPath,
        args: [fileURLToPath(new URL('./fixtures/docker.mjs', import.meta.url))],
        env: { DOCKER_FAKE_STATE: join(dir(), 'docker.json'), SSH_FAKE_LOG: sshLog(), PATH: `${cloudInit()}${delimiter}${process.env.PATH ?? ''}` },
        ssh: { command: process.execPath, args: [SSH], machines: { jump: { destination: 'ops@jump' } } },
        proxmox: { url, tokenId: TOKEN, secret: { $secret: 'host:proxmox' }, node: NODE, storage: 'local-lvm', bridge: 'vmbr0', template: TEMPLATE, ca: caFile },
        profiles: { pve: { runtime: 'proxmox', server: 'jump' } },
      },
    }],
    { base, configDir: join(dir(), 'state'), cwd: join(import.meta.dirname, '../../..'), log: (line) => { logged.push(line); }, hostId: 'host-a' },
  );
  keeping(result.options);
  const provider = result.options.resourceProviders?.computer as {
    write(uri: string, content: { data: string; encoding: string }, owner?: string): Promise<void>;
    list(uri: string): Promise<{ name: string }[]>;
  };
  return { logged, provider };
};

const body = (said: unknown) => ({ data: JSON.stringify(said), encoding: 'utf-8' });

it.skipIf(!posix)('makes a profile\'s machine as a VM on the node, with the secret the vault holds, and lists it under proxmox', async () => {
  const { provider, logged } = await load(holding({ 'host:proxmox': SECRET }));
  await provider.write('computer://box', body({ profile: 'pve' }), 'user:ana');
  expect(vmCalled('box')).toMatchObject({ status: 'running' });
  expect((await provider.list('computer://')).map((one) => one.name)).toContain('proxmox.box');
  expect(ssh().find((one) => one.includes(`ahpd@${ADDRESS}`))).toEqual(expect.arrayContaining(['-J', 'ops@jump']));
  expect(logged.join('\n')).not.toContain(SECRET);
});

it.skipIf(!posix)('works without the secret, and refuses only a Proxmox machine, by the secret\'s name', async () => {
  const { provider, logged } = await load(holding({}));
  await provider.write('computer://box', body({ image: 'node:22' }), 'user:ana');
  const listed = (await provider.list('computer://')).map((one) => one.name);
  expect(listed).toContain('box');
  expect(logged).toContainEqual(expect.stringContaining('Could not list the proxmox machines'));
  await expect(provider.write('computer://vm', body({ profile: 'pve' }), 'user:ana'))
    .rejects.toThrow(/the proxmox option's secret host:proxmox could not be read/);
  expect(vmCalled('vm')).toBeUndefined();
});
