/**
 * The fetch a piece's logo takes, in the plugin's own process.
 *
 * Only `https:` is read, and the address a name resolves to is checked before
 * a socket opens, by Activepieces' classifier: an address that is not unicast
 * is blocked, in `SSRFBlockedError`'s words. Any one such address blocks the
 * call, because a name that answers on two is a name this plugin does not
 * trust either way.
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
import { SSRFBlockedError, isBlockedIp } from './guard.ts';

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
    const blocked = addresses.find((one) => isBlockedIp(one.address));
    if (blocked !== undefined) throw new SSRFBlockedError(name, blocked.address);
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
