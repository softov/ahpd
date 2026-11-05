/**
 * The fetch one `FILE` value's `https:` URL takes, in the engine, and a
 * piece's logo, in the plugin's own process.
 *
 * Only `https:` is read, and the address a name resolves to is checked before
 * a socket opens: a loopback, link-local, private or unspecified address is
 * refused. Any one such address refuses the call, because a name that answers
 * on two is a name this plugin does not trust either way.
 *
 * The check runs after the lookup and again on every redirect, because a
 * public URL may answer with one that points into the host's own network. The
 * connection goes to the address that was checked, so a second lookup cannot
 * choose another one, and the certificate is still the name's.
 *
 * An answer is read to a size and within a time. A refusal names the host it
 * was about and never the URL, because a signed URL carries its token in the
 * query and a sentence of this kind is written to a problem line.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

/** One address a host name resolved to. */
export interface Address {
  /** The address, as a name lookup or a URL literal writes it. */
  address: string;
  /** 4 or 6, the family the address is in. */
  family: number;
}

/** How a host name is resolved. A test gives its own, and no socket opens. */
export type Lookup = (hostname: string) => Promise<Address[]>;

/** What this plugin reads of one HTTP answer. */
export interface Answer {
  /** The status the server answered. */
  status: number;
  /** The headers, each name lowercased. */
  headers: Record<string, string | undefined>;
  /** The body. */
  bytes: Buffer;
}

/** How one request is made: to the checked address, for the URL it stands for. */
export type Requester = (url: URL, address: string) => Promise<Answer>;

/** What a caller may hand a fetch, mostly so a test reaches no network. */
export interface FetchOptions {
  /** How a host name is resolved; `dns.lookup` otherwise. */
  lookup?: Lookup;
  /** How the request is made; an https request otherwise. */
  request?: Requester;
  /** The most redirects to follow; five otherwise. */
  redirects?: number;
  /** The most bytes one answer may hold; 32 MB otherwise. */
  maxBytes?: number;
  /** The longest one request may take; 30 s otherwise. */
  timeoutMs?: number;
}

/** The most redirects one fetch follows before it is refused. */
const MOST_REDIRECTS = 5;

/**
 * The most bytes one answer may hold.
 *
 * The host reads an attachment up to the same size, so a file this fetch reads
 * is of a size the session already takes in.
 */
const MOST_BYTES = 32 * 1024 * 1024;

/** The longest one request may take, so a server that never answers costs 30 s. */
const WITHIN_MS = 30_000;

/** The name a URL is for, with the brackets of an IPv6 literal removed. */
const hostOf = (url: URL): string => url.hostname.replace(/^\[|\]$/gu, '');

/** A size, as the largest whole unit it is a multiple of. */
const sizeOf = (bytes: number): string => {
  if (bytes >= 1024 * 1024 && bytes % (1024 * 1024) === 0) return `${String(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024 && bytes % 1024 === 0) return `${String(bytes / 1024)} KB`;
  return `${String(bytes)} bytes`;
};

/** A span, as the largest whole unit it is a multiple of. */
const spanOf = (ms: number): string => {
  if (ms >= 1000 && ms % 1000 === 0) return `${String(ms / 1000)} s`;
  return `${String(ms)} ms`;
};

/** The refusal of an answer larger than this plugin reads. */
const tooLarge = (at: URL, most: number): Error => new Error(`${at.host} answers with more than ${sizeOf(most)}`);

/** The refusal of a request that took longer than it may. */
const tooSlow = (at: URL, within: number): Error => new Error(`${at.host} did not answer within ${spanOf(within)}`);

/** The system's lookup, which answers every address a name has. */
const systemLookup: Lookup = async (hostname) => await dnsLookup(hostname, { all: true, verbatim: true });

/** The headers this plugin reads, each name lowercased and the first value kept. */
const keptHeaders = (headers: Record<string, string | string[] | undefined>): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return out;
};

/**
 * One https request, to the address that was checked.
 *
 * `hostname` is the address rather than the name, so Node opens the socket
 * there and never looks the name up again. `servername` stays the name, so the
 * certificate is still checked against what the URL said. The body stops at
 * the size it may reach, which is read from `content-length` first where the
 * server sends it, and counted as the bytes arrive otherwise. A request that
 * takes longer than it may is ended, and its socket with it.
 */
const httpsOf = (most: number, within: number): Requester => (url, address) => new Promise((resolve, reject) => {
  const name = hostOf(url);
  let late: NodeJS.Timeout | undefined;
  const stop = (): void => { if (late !== undefined) clearTimeout(late); };
  const asked = httpsRequest({
    hostname: address,
    port: url.port === '' ? 443 : Number(url.port),
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    ...(isIP(name) === 0 ? { servername: name } : {}),
    headers: { host: url.host, accept: '*/*', 'user-agent': 'ahpd' },
  }, (answer) => {
    const hinted = Number(answer.headers['content-length'] ?? '');
    if (Number.isFinite(hinted) && hinted > most) {
      stop();
      answer.destroy();
      asked.destroy();
      reject(tooLarge(url, most));
      return;
    }
    const chunks: Buffer[] = [];
    let held = 0;
    answer.on('data', (chunk: Buffer) => {
      held += chunk.length;
      if (held > most) {
        stop();
        answer.destroy();
        asked.destroy();
        reject(tooLarge(url, most));
        return;
      }
      chunks.push(chunk);
    });
    answer.on('end', () => {
      stop();
      resolve({ status: answer.statusCode ?? 0, headers: keptHeaders(answer.headers), bytes: Buffer.concat(chunks) });
    });
    answer.on('error', (error) => { stop(); reject(error); });
  });
  late = setTimeout(() => { asked.destroy(tooSlow(url, within)); }, within);
  asked.on('error', (error) => { stop(); reject(error); });
  asked.end();
});

/** The four octets of an IPv4 address, as written. */
const octets = (text: string): number[] => text.split('.').map((one) => Number(one));

/** Whether an IPv4 address is one this plugin does not fetch. */
const refusedV4 = (taken: readonly number[]): boolean => {
  if (taken.length !== 4 || taken.some((one) => !Number.isInteger(one) || one < 0 || one > 255)) return true;
  const a = taken[0] ?? 0;
  const b = taken[1] ?? 0;
  return a === 0 // Unspecified, and the whole of `0.0.0.0/8`.
    || a === 127 // Loopback.
    || (a === 169 && b === 254) // Link-local, the metadata service among them.
    || a === 10 // Private.
    || (a === 172 && b >= 16 && b <= 31) // Private.
    || (a === 192 && b === 168) // Private.
    || (a === 100 && b >= 64 && b <= 127) // Shared address space, `100.64.0.0/10`.
    || (a === 198 && (b === 18 || b === 19)) // Benchmarking, `198.18.0.0/15`.
    || (a >= 224 && a <= 239) // Multicast, `224.0.0.0/4`.
    || a >= 240; // Reserved, `240.0.0.0/4` and the broadcast address in it.
};

/**
 * One written group as 16-bit numbers.
 *
 * An IPv4 address written as the last group is two groups: that is how
 * `::ffff:127.0.0.1`, and the older `::127.0.0.1`, are written.
 */
const groupOf = (text: string): number[] | undefined => {
  if (!text.includes('.')) return /^[0-9a-f]{1,4}$/iu.test(text) ? [parseInt(text, 16)] : undefined;
  const v4 = octets(text);
  if (v4.length !== 4 || v4.some((one) => !Number.isInteger(one) || one < 0 || one > 255)) return undefined;
  return [((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0)];
};

/** The eight 16-bit groups of an IPv6 address, or nothing when it cannot be read. */
function groupsOf(address: string): number[] | undefined {
  const bare = address.split('%')[0] ?? '';
  if (bare === '') return undefined;
  const halves = bare.split('::');
  if (halves.length > 2) return undefined;
  const written = (half: string): number[] | undefined => {
    const out: number[] = [];
    if (half === '') return out;
    for (const one of half.split(':')) {
      const group = groupOf(one);
      if (group === undefined) return undefined;
      out.push(...group);
    }
    return out;
  };
  const left = written(halves[0] ?? '');
  const right = halves.length === 2 ? written(halves[1] ?? '') : [];
  if (left === undefined || right === undefined) return undefined;
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (halves.length === 2 && fill < 0) return undefined;
  const out = halves.length === 2 ? [...left, ...new Array<number>(fill).fill(0), ...right] : left;
  return out.length === 8 ? out : undefined;
}

/** The IPv4 address the last two groups of an IPv6 address hold. */
const embeddedV4 = (groups: readonly number[]): number[] => [
  (groups[6] ?? 0) >> 8,
  (groups[6] ?? 0) & 0xff,
  (groups[7] ?? 0) >> 8,
  (groups[7] ?? 0) & 0xff,
];

/** Whether an IPv6 address is one this plugin does not fetch. */
const refusedV6 = (address: string): boolean => {
  const groups = groupsOf(address);
  if (groups === undefined) return true;
  // The unspecified address `::`.
  if (groups.every((one) => one === 0)) return true;
  // The loopback address `::1`.
  if (groups.slice(0, 7).every((one) => one === 0) && groups[7] === 1) return true;
  // An IPv4 address written as IPv6: `::ffff:a.b.c.d`, and the older `::a.b.c.d`.
  const mapped = groups.slice(0, 5).every((one) => one === 0) && groups[5] === 0xffff;
  const compatible = groups.slice(0, 6).every((one) => one === 0);
  if (mapped || compatible) return refusedV4(embeddedV4(groups));
  // Link-local `fe80::/10`, and the unique local addresses `fc00::/7`.
  if (((groups[0] ?? 0) & 0xffc0) === 0xfe80) return true;
  if (((groups[0] ?? 0) & 0xfe00) === 0xfc00) return true;
  // Multicast, `ff00::/8`.
  if (((groups[0] ?? 0) & 0xff00) === 0xff00) return true;
  // A NAT64 address, `64:ff9b::/96`, is the IPv4 address it holds.
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((one) => one === 0)) {
    return refusedV4(embeddedV4(groups));
  }
  return false;
};

/**
 * Whether an address is one this plugin does not fetch.
 *
 * A string that is not an address is refused too, so an answer this code
 * cannot read is never one it connects to.
 */
export function refused(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return refusedV4(octets(address));
  if (version === 6) return refusedV6(address);
  return true;
}

/** One URL, or the refusal that repeats nothing of it. */
const parsed = (url: string): URL => {
  try {
    return new URL(url);
  } catch {
    // The value stays out of the sentence: it may carry a token of its own.
    throw new Error('this value is not a URL');
  }
};

/** One redirect's target, or the refusal that repeats nothing of it. */
const targetOf = (location: string, at: URL): URL => {
  try {
    return new URL(location, at);
  } catch {
    throw new Error(`${at.host} redirects to a value that is not a URL`);
  }
};

/**
 * The answer, or the refusal when the request takes longer than it may.
 *
 * The real request ends its own socket when the time runs out. This covers a
 * request a caller gave, which has no socket to end.
 */
const withinTime = async (asked: Promise<Answer>, within: number, at: URL): Promise<Answer> => {
  let late: NodeJS.Timeout | undefined;
  // The request is still owed an answer when the timer wins, so its own failure
  // is read here rather than left unhandled.
  void asked.catch(() => undefined);
  const timer = new Promise<never>((_answer, refuse) => {
    late = setTimeout(() => { refuse(tooSlow(at, within)); }, within);
  });
  try {
    return await Promise.race([asked, timer]);
  } finally {
    if (late !== undefined) clearTimeout(late);
  }
};

/** The answer, or the refusal when it is larger than this plugin reads. */
const checkedSize = (answer: Answer, at: URL, most: number): Answer => {
  const hinted = Number(answer.headers['content-length'] ?? '');
  if ((Number.isFinite(hinted) && hinted > most) || answer.bytes.length > most) throw tooLarge(at, most);
  return answer;
};

/**
 * Read one `https:` URL, following each redirect by hand.
 *
 * `url` must be `https:`. Each hop resolves the name, refuses any address that
 * is not public, and connects to an address that was checked. A redirect is
 * read from the answer and checked as a new hop, so a public URL that answers
 * with a private one is refused rather than followed. Each answer is held to
 * `maxBytes`, and each request to `timeoutMs`.
 */
export async function fetched(url: string, options: FetchOptions = {}): Promise<Answer> {
  const lookup = options.lookup ?? systemLookup;
  const most = options.maxBytes ?? MOST_BYTES;
  const within = options.timeoutMs ?? WITHIN_MS;
  const mostRedirects = options.redirects ?? MOST_REDIRECTS;
  const request = options.request ?? httpsOf(most, within);
  const start = parsed(url);
  let at = start;
  for (let hop = 0; ; hop++) {
    if (at.protocol !== 'https:') {
      throw new Error(`only an https: URL is fetched, and ${at.protocol} is not`);
    }
    const name = hostOf(at);
    const version = isIP(name);
    const addresses = version === 0 ? await lookup(name) : [{ address: name, family: version }];
    if (addresses.length === 0) throw new Error(`${name} did not resolve to an address`);
    if (addresses.some((one) => refused(one.address))) {
      throw new Error(`${name} answers on an address that this plugin does not fetch`);
    }
    const answer = checkedSize(await withinTime(request(at, (addresses[0] as Address).address), within, at), at, most);
    const location = answer.headers['location'];
    if (answer.status >= 300 && answer.status < 400 && location !== undefined && location !== '') {
      if (hop >= mostRedirects) throw new Error(`${start.host} answers with more than ${mostRedirects} redirects`);
      at = targetOf(location, at);
      continue;
    }
    return answer;
  }
}
