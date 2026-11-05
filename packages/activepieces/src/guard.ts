import dns from 'node:dns';
import { syncBuiltinESMExports } from 'node:module';
import { isIP, Socket } from 'node:net';
import ipaddr from 'ipaddr.js';

/**
 * Activepieces' SSRF guard, as its engine installs it.
 *
 * An address is blocked unless it is unicast, as ipaddr.js names ranges, an
 * IPv4 address written as IPv6 read as the IPv4 it holds, and unless the allow
 * list holds it by itself or in one of its CIDR ranges. With the network mode
 * `STRICT`, the engine process patches `dns.lookup`, its promise twin and
 * `Socket.prototype.connect`, so a name that resolves to a blocked address,
 * and a socket opened to one, fail with `SSRFBlockedError`'s words, whoever in
 * the process asked: a piece's own client as much as a `FILE` value's fetch.
 * The patches stop a piece that fetches a URL it was handed into the host's
 * own network; they are no boundary against code written to get round them.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/core/utils/src/lib/ssrf-ip-classifier.ts
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/engine/src/lib/network/ssrf-guard.ts
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/engine/src/lib/network/dns-lookup-guard.ts
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/engine/src/lib/network/socket-connect-guard.ts
 */

/** An address, or nothing for a string that is none. */
const parseOrNull = (ip: string): ipaddr.IPv4 | ipaddr.IPv6 | null => {
  try {
    return ipaddr.parse(ip);
  }
  catch {
    return null;
  }
};

/** Whether an address is in one CIDR range of its own family. */
const matchesCidr = (addr: ipaddr.IPv4 | ipaddr.IPv6, cidr: string): boolean => {
  try {
    const range = ipaddr.parseCIDR(cidr);
    if (addr.kind() !== range[0].kind()) return false;
    return addr.match(range);
  }
  catch {
    return false;
  }
};

/** Whether the allow list holds an address, by itself or in one of its CIDR ranges. */
const isInAllowList = (ip: string, allowList: readonly string[]): boolean => {
  if (allowList.includes(ip)) return true;
  const addr = parseOrNull(ip);
  if (addr === null) return false;
  return allowList.some((entry) => entry.includes('/') && matchesCidr(addr, entry));
};

/** Whether an address is in a range that is not unicast, an IPv4-mapped one read as its IPv4. */
const isBlockedRange = (addr: ipaddr.IPv4 | ipaddr.IPv6): boolean => {
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    return isBlockedRange((addr as ipaddr.IPv6).toIPv4Address());
  }
  return addr.range() !== 'unicast';
};

/** Whether an address is blocked: the classifier's `isBlockedIp`, a string that is no address blocked too. */
export const isBlockedIp = (ip: string, allowList: readonly string[] = []): boolean => {
  if (isInAllowList(ip, allowList)) return false;
  const addr = parseOrNull(ip);
  if (addr === null) return true;
  return isBlockedRange(addr);
};

/**
 * The error a blocked connection fails with: `SSRFBlockedError`, its message
 * the engine's formatted JSON.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/core/execution/src/lib/engine/execution-errors.ts#L158-L167
 */
export class SSRFBlockedError extends Error {
  constructor(host: string, ip: string) {
    super(JSON.stringify({
      message: `SSRF protection: refusing to connect to ${host} (resolved ${ip}), private, loopback, link-local, or multicast address`,
    }, null, 2));
    this.name = 'SSRFBlockedError';
  }
}

/** The network modes Activepieces' operator chooses from: `STRICT` guards, `UNRESTRICTED` does not. */
export const NETWORK_MODES = ['STRICT', 'UNRESTRICTED'] as const;

/** One network mode. */
export type NetworkMode = typeof NETWORK_MODES[number];

/** A comma-separated list, each entry trimmed and the empty ones left out. */
const splitCsv = (raw: string | undefined): string[] =>
  (raw === undefined || raw === '' ? [] : raw.split(',').map((one) => one.trim()).filter((one) => one !== ''));

/** One lookup's answers, as a list whatever the caller asked for. */
const toAddressList = (address: string | dns.LookupAddress[], family: number | undefined): dns.LookupAddress[] =>
  (Array.isArray(address) ? address : [{ address, family: family ?? 4 }]);

/** `dns.lookup`, and its promise twin, refusing a name that resolves to a blocked address. */
const installDnsLookupGuard = (allowList: readonly string[]): void => {
  const originalLookup = dns.lookup;
  const boundLookup = originalLookup.bind(dns) as (hostname: string, options: dns.LookupAllOptions, callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void) => void;
  const boundPromisesLookup = dns.promises.lookup.bind(dns.promises);
  const guardedLookup = function lookup(
    hostname: string,
    optionsOrCallback: dns.LookupOptions | number | ((err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void),
    maybeCallback?: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
  ): void {
    const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
    const callerOptions = typeof optionsOrCallback === 'object' && optionsOrCallback !== null ? optionsOrCallback : undefined;
    boundLookup(hostname, { ...callerOptions, all: true }, (err, address) => {
      if (err !== null || callback === undefined) {
        callback?.(err, address);
        return;
      }
      const entries = toAddressList(address, undefined);
      const blocked = entries.find((entry) => isBlockedIp(entry.address, allowList));
      if (blocked !== undefined) {
        callback(new SSRFBlockedError(hostname, blocked.address), '', 0);
        return;
      }
      if (callerOptions?.all === true) {
        callback(null, entries);
        return;
      }
      const first = entries[0];
      if (first === undefined) {
        callback(null, '', 0);
        return;
      }
      callback(null, first.address, first.family);
    });
  };
  // Node hangs `util.promisify.custom` off the original, which `dns.promises`
  // and a promisified lookup read.
  Object.assign(guardedLookup, originalLookup);
  const guardedPromisesLookup = async (hostname: string, options?: dns.LookupOptions): Promise<dns.LookupAddress | dns.LookupAddress[]> => {
    const all = await boundPromisesLookup(hostname, { ...options, all: true });
    const blocked = all.find((entry) => isBlockedIp(entry.address, allowList));
    if (blocked !== undefined) throw new SSRFBlockedError(hostname, blocked.address);
    return options?.all === true ? all : all[0] as dns.LookupAddress;
  };
  (dns as { lookup: unknown }).lookup = guardedLookup;
  (dns.promises as { lookup: unknown }).lookup = guardedPromisesLookup;
  // A module that imports `lookup` by name reads the ES module's own copy of
  // the export, which follows the module object only once synced.
  syncBuiltinESMExports();
};

/**
 * `Socket.prototype.connect`, refusing a socket opened to a blocked address
 * written as one.
 *
 * `net.connect`, and `tls.connect` and `fetch` through it, hand `connect` the
 * arguments it normalized as one array, whose first entry is the options. That
 * form is read too, an addition of ours to the engine's reading of the
 * arguments, so an address written into a URL is blocked as the guard means.
 */
const installSocketConnectGuard = (allowList: readonly string[]): void => {
  const originalConnect = Socket.prototype.connect;
  Socket.prototype.connect = function guardedConnect(this: Socket, ...args: unknown[]): Socket {
    const first: unknown = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
    const host = typeof first === 'object' && first !== null && !Array.isArray(first)
      ? (first as { host?: unknown }).host
      : typeof first === 'number' ? (typeof args[1] === 'string' ? args[1] : '127.0.0.1') : undefined;
    if (typeof host === 'string' && isIP(host) !== 0 && isBlockedIp(host, allowList)) {
      this.destroy(new SSRFBlockedError(host, host));
      return this;
    }
    return (originalConnect as (...given: unknown[]) => Socket).apply(this, args);
  } as typeof Socket.prototype.connect;
};

/**
 * The guard, installed as the engine installs it when the process starts:
 * on for `AP_NETWORK_MODE=STRICT`, the allow list from `AP_SSRF_ALLOW_LIST`.
 * DNS first, so a name fails where it resolves, then the socket, which catches
 * an address written as one.
 */
export const installSsrfGuard = (env: NodeJS.ProcessEnv = process.env): boolean => {
  if (env['AP_NETWORK_MODE'] !== 'STRICT') return false;
  const allowList = splitCsv(env['AP_SSRF_ALLOW_LIST']);
  installDnsLookupGuard(allowList);
  installSocketConnectGuard(allowList);
  return true;
};
