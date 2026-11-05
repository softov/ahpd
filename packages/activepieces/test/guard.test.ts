import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { SSRFBlockedError, isBlockedIp } from '../src/guard.js';

/*
 * Activepieces' SSRF guard: its classifier, and the guard the engine installs.
 *
 * The classifier is asked directly. The guard patches the process it runs in,
 * so a case forks a process of its own that installs it and then looks names
 * up and opens sockets, and nothing of the test process is patched.
 */

/** Addresses in a range ipaddr.js names other than unicast, each named by what it is. */
const BLOCKED: [string, string][] = [
  ['an IPv4 loopback address', '127.0.0.1'],
  ['the IPv6 loopback address', '::1'],
  ['the IPv4 link-local metadata service', '169.254.169.254'],
  ['an IPv6 link-local address', 'fe80::1'],
  ['a private IPv4 address', '10.0.0.1'],
  ['another private IPv4 address', '172.16.0.1'],
  ['a third private IPv4 address', '192.168.1.1'],
  ['a unique local IPv6 address', 'fd12:3456:789a::1'],
  ['the unspecified IPv4 address', '0.0.0.0'],
  ['the unspecified IPv6 address', '::'],
  ['an IPv4-mapped IPv6 loopback address', '::ffff:127.0.0.1'],
  ['the shared address space', '100.64.0.1'],
  ['a benchmarking address', '198.18.0.1'],
  ['a documentation address', '192.0.2.1'],
  ['an IPv4 multicast address', '224.0.0.1'],
  ['a reserved IPv4 address', '240.0.0.1'],
  ['the IPv4 broadcast address', '255.255.255.255'],
  ['an IPv6 multicast address', 'ff02::1'],
  ['a NAT64 address', '64:ff9b::93.184.216.34'],
  ['a 6to4 address', '2002:c000:0204::1'],
  ['a Teredo address', '2001:0:4136:e378::1'],
];

describe('the classifier', () => {
  for (const [what, address] of BLOCKED) {
    it(`blocks ${what}, ${address}`, () => {
      expect(isBlockedIp(address)).toBe(true);
    });
  }

  it('lets a unicast address through, and an IPv4-mapped one by the IPv4 it holds', () => {
    expect(isBlockedIp('93.184.216.34')).toBe(false);
    expect(isBlockedIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
    expect(isBlockedIp('::ffff:93.184.216.34')).toBe(false);
  });

  it('lets through what the allow list holds, by itself or in one of its CIDR ranges', () => {
    expect(isBlockedIp('10.0.0.5', ['10.0.0.5'])).toBe(false);
    expect(isBlockedIp('10.1.2.3', ['10.0.0.0/8'])).toBe(false);
    expect(isBlockedIp('192.168.1.1', ['10.0.0.0/8'])).toBe(true);
    expect(isBlockedIp('::1', ['10.0.0.0/8'])).toBe(true);
  });

  it('blocks a value that is not an address', () => {
    expect(isBlockedIp('files.example')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });

  it('words a block as SSRFBlockedError does', () => {
    const blocked = new SSRFBlockedError('internal.example', '10.0.0.5');
    expect(blocked.name).toBe('SSRFBlockedError');
    expect(JSON.parse(blocked.message)).toEqual({
      message: 'SSRF protection: refusing to connect to internal.example (resolved 10.0.0.5), private, loopback, link-local, or multicast address',
    });
  });
});

/** What one probe met. */
interface Probe {
  installed: boolean;
  lookup: string;
  socket: string;
  fetch: string;
}

/**
 * One process that installs the guard as the engine does, under the
 * environment given, and answers what a lookup of `localhost` by its imported
 * name, a socket to 127.0.0.1 and a fetch of a URL naming it met.
 */
const probed = (env: Record<string, string>): Promise<Probe> => new Promise((resolve, reject) => {
  const script = `
    const { installSsrfGuard } = await import(${JSON.stringify(new URL('../src/guard.ts', import.meta.url).href)});
    const installed = installSsrfGuard();
    const { lookup: named } = await import('node:dns');
    const net = await import('node:net');
    const lookup = await new Promise((done) => named('localhost', (error, address) => done(error ? error.name : address)));
    const socket = await new Promise((done) => {
      const one = net.connect({ host: '127.0.0.1', port: 9 });
      one.on('error', (error) => done(error.name === 'SSRFBlockedError' ? 'SSRFBlockedError' : 'other'));
      one.on('connect', () => { one.destroy(); done('connected'); });
    });
    const fetched = await fetch('http://127.0.0.1:61234/').then(() => 'answered', (error) => error.cause?.name === 'SSRFBlockedError' ? 'SSRFBlockedError' : 'other');
    process.send({ installed, lookup, socket, fetch: fetched });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: { PATH: process.env['PATH'] ?? '', ...env },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  const timer = setTimeout(() => { child.kill(); reject(new Error('the probe did not answer')); }, 10_000);
  child.once('message', (message) => {
    clearTimeout(timer);
    child.kill();
    resolve(message as Probe);
  });
});

describe('the guard the engine installs', () => {
  it('blocks a name that resolves to a blocked address, a socket to one and a URL naming one, under STRICT', async () => {
    expect(await probed({ AP_NETWORK_MODE: 'STRICT' })).toEqual({ installed: true, lookup: 'SSRFBlockedError', socket: 'SSRFBlockedError', fetch: 'SSRFBlockedError' });
  });

  it('lets the allow list through under STRICT, and installs nothing under UNRESTRICTED', async () => {
    const allowed = await probed({ AP_NETWORK_MODE: 'STRICT', AP_SSRF_ALLOW_LIST: '127.0.0.0/8,::1' });
    expect(allowed.installed).toBe(true);
    expect([allowed.lookup, allowed.socket, allowed.fetch]).not.toContain('SSRFBlockedError');
    const open = await probed({ AP_NETWORK_MODE: 'UNRESTRICTED' });
    expect(open.installed).toBe(false);
    expect([open.lookup, open.socket, open.fetch]).not.toContain('SSRFBlockedError');
  });
});
