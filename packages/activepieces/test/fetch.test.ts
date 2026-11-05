import { describe, expect, it } from 'vitest';
import { fetched } from '../src/fetch.js';
import type { Address, Answer, Lookup } from '../src/fetch.js';

/*
 * The fetch a piece's logo takes.
 *
 * Every case resolves a name with a lookup of its own and makes its request
 * with one of its own, so no name is looked up for real and no socket opens.
 * The addresses here are the ones a daemon must never read: a metadata service
 * is the case that matters most.
 */

/** One answer, as a status and headers, with bytes that no case reads. */
const answered = (status: number, headers: Record<string, string | undefined> = {}): Answer => ({
  status,
  headers,
  bytes: Buffer.from('bytes'),
});

/** A lookup that answers each name from a table, and fails on any other name. */
const lookups = (addresses: Record<string, Address[]>): ((hostname: string) => Promise<Address[]>) =>
  async (hostname) => {
    const held = addresses[hostname];
    if (held === undefined) throw new Error(`the case looked up ${hostname}`);
    return held;
  };

/** One address, in the family it is written in. */
const at = (address: string): Address => ({ address, family: address.includes(':') ? 6 : 4 });

/** A request that fails the case when one is made. */
const never = async (): Promise<Answer> => {
  throw new Error('a request was made');
};

/** A lookup that fails the case when a name is looked up. */
const noLookup: Lookup = async (hostname) => {
  throw new Error(`the case looked up ${hostname}`);
};

/** The sentence a refusal is, so a case can read it as well as match it. */
const messageOf = async (asked: Promise<unknown>): Promise<string> => {
  try {
    await asked;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('the case was not refused');
};

/** What Activepieces' guard says of a name that resolved to a blocked address. */
const blockedAt = (host: string, ip: string): string => `SSRF protection: refusing to connect to ${host} (resolved ${ip})`;

/** The addresses a call must block, each named by what it is: none of them unicast. */
const BLOCKED: [string, string][] = [
  ['an IPv4 loopback address', '127.0.0.1'],
  ['the end of the IPv4 loopback range', '127.255.255.254'],
  ['the IPv6 loopback address', '::1'],
  ['the IPv4 link-local metadata service', '169.254.169.254'],
  ['another IPv4 link-local address', '169.254.1.1'],
  ['an IPv6 link-local address', 'fe80::1'],
  ['the end of the IPv6 link-local range', 'febf::1'],
  ['a private IPv4 address', '10.0.0.1'],
  ['a private IPv4 address in the middle range', '172.16.0.1'],
  ['the end of the private middle range', '172.31.255.255'],
  ['another private IPv4 address', '192.168.1.1'],
  ['a unique local IPv6 address', 'fc00::1'],
  ['another unique local IPv6 address', 'fd12:3456:789a::1'],
  ['the unspecified IPv4 address', '0.0.0.0'],
  ['the unspecified IPv6 address', '::'],
  ['an IPv4-mapped IPv6 loopback address', '::ffff:127.0.0.1'],
  ['an IPv4-mapped IPv6 private address', '::ffff:10.0.0.1'],
  ['the start of the shared address space', '100.64.0.1'],
  ['the end of the shared address space', '100.127.255.255'],
  ['an IPv4 benchmarking address', '198.18.0.1'],
  ['the end of the benchmarking range', '198.19.255.255'],
  ['an IPv4 multicast address', '224.0.0.1'],
  ['the end of the IPv4 multicast range', '239.255.255.255'],
  ['a reserved IPv4 address', '240.0.0.1'],
  ['the IPv4 broadcast address', '255.255.255.255'],
  ['an IPv6 multicast address', 'ff02::1'],
  ['a NAT64 address for a private IPv4 address', '64:ff9b::10.0.0.1'],
];

describe('a fetch blocks an address that is not unicast', () => {
  for (const [what, address] of BLOCKED) {
    it(`blocks ${what}, ${address}`, async () => {
      await expect(fetched('https://files.example/a.png', {
        lookup: lookups({ 'files.example': [at(address)] }),
        request: never,
      })).rejects.toThrow(blockedAt('files.example', address));
    });
  }

  it('blocks a name that answers on a public and a private address', async () => {
    await expect(fetched('https://files.example/a.png', {
      lookup: lookups({ 'files.example': [at('93.184.216.34'), at('10.0.0.1')] }),
      request: never,
    })).rejects.toThrow(blockedAt('files.example', '10.0.0.1'));
  });

  it('refuses a name that did not resolve', async () => {
    await expect(fetched('https://files.example/a.png', {
      lookup: lookups({ 'files.example': [] }),
      request: never,
    })).rejects.toThrow('files.example did not resolve to an address');
  });

  it('blocks a literal address in the URL, without looking it up', async () => {
    await expect(fetched('https://169.254.169.254/latest/meta-data/', { lookup: noLookup, request: never }))
      .rejects.toThrow(blockedAt('169.254.169.254', '169.254.169.254'));
    await expect(fetched('https://[::1]/x', { lookup: noLookup, request: never }))
      .rejects.toThrow(blockedAt('::1', '::1'));
  });

  it('blocks an address the URL parser writes out for a shorter form', async () => {
    // The parser turns an integer, a hex number or a short form into the dotted
    // address it holds, so the check sees the address and not the spelling.
    for (const url of ['https://2130706433/x', 'https://0x7f000001/x', 'https://127.1/x']) {
      await expect(fetched(url, { lookup: noLookup, request: never }))
        .rejects.toThrow(blockedAt('127.0.0.1', '127.0.0.1'));
    }
  });
});

describe('a fetch reads only https:', () => {
  it('refuses an http: URL before a name is looked up', async () => {
    await expect(fetched('http://files.example/a.png', { lookup: noLookup, request: never }))
      .rejects.toThrow('only an https: URL is fetched, and http: is not');
  });

  it('refuses another scheme', async () => {
    await expect(fetched('file:///etc/passwd', { lookup: noLookup, request: never }))
      .rejects.toThrow('only an https: URL is fetched, and file: is not');
  });

  it('refuses a value that is not a URL, and repeats nothing of it', async () => {
    const said = await messageOf(fetched('ht!tps://files.example/a?token=secret', { lookup: noLookup, request: never }));

    expect(said).toBe('this value is not a URL');
    expect(said).not.toContain('secret');
  });
});

describe('a fetch reads a public address', () => {
  it('sends the request to the address it checked, and answers it', async () => {
    const went: { url: string; address: string }[] = [];
    const answer = await fetched('https://files.example/a.png', {
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async (url, address) => {
        went.push({ url: url.href, address });
        return answered(200);
      },
    });

    expect(answer.status).toBe(200);
    expect(went).toEqual([{ url: 'https://files.example/a.png', address: '93.184.216.34' }]);
  });

  it('follows a redirect to a public address', async () => {
    const went: string[] = [];
    const answer = await fetched('https://files.example/a.png', {
      lookup: lookups({
        'files.example': [at('93.184.216.34')],
        'cdn.example': [at('93.184.216.35')],
      }),
      request: async (url, address) => {
        went.push(address);
        return url.hostname === 'files.example'
          ? answered(302, { location: 'https://cdn.example/b.png' })
          : answered(200);
      },
    });

    expect(answer.status).toBe(200);
    expect(went).toEqual(['93.184.216.34', '93.184.216.35']);
  });
});

describe('a fetch checks each redirect', () => {
  it('blocks a redirect to a private address', async () => {
    const went: string[] = [];
    await expect(fetched('https://files.example/a.png', {
      lookup: lookups({
        'files.example': [at('93.184.216.34')],
        'internal.example': [at('10.0.0.5')],
      }),
      request: async (url, address) => {
        went.push(address);
        return url.hostname === 'files.example'
          ? answered(302, { location: 'https://internal.example/secret' })
          : answered(200);
      },
    })).rejects.toThrow(blockedAt('internal.example', '10.0.0.5'));

    expect(went).toEqual(['93.184.216.34']);
  });

  it('blocks a redirect to the metadata service', async () => {
    await expect(fetched('https://files.example/a.png', {
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async () => answered(302, { location: 'https://169.254.169.254/latest/meta-data/' }),
    })).rejects.toThrow(blockedAt('169.254.169.254', '169.254.169.254'));
  });

  it('refuses a redirect that is not https:', async () => {
    await expect(fetched('https://files.example/a.png', {
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async () => answered(302, { location: 'http://files.example/a.png' }),
    })).rejects.toThrow('only an https: URL is fetched, and http: is not');
  });

  it('refuses more redirects than it follows', async () => {
    await expect(fetched('https://files.example/a.png', {
      redirects: 2,
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async () => answered(302, { location: '/again' }),
    })).rejects.toThrow('answers with more than 2 redirects');
  });
});

describe('a fetch reads no answer larger than it may', () => {
  it('refuses an answer whose content-length is over the limit, before a byte is held', async () => {
    await expect(fetched('https://files.example/a.png', {
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async () => answered(200, { 'content-length': String(32 * 1024 * 1024 + 1) }),
    })).rejects.toThrow('files.example answers with more than 32 MB');
  });

  it('refuses an answer whose bytes are over the limit it was given', async () => {
    await expect(fetched('https://files.example/a.png', {
      maxBytes: 4,
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async () => ({ status: 200, headers: {}, bytes: Buffer.from('bytes') }),
    })).rejects.toThrow('files.example answers with more than 4 bytes');
  });

  it('reads an answer that is exactly at the limit', async () => {
    const answer = await fetched('https://files.example/a.png', {
      maxBytes: 5,
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async () => answered(200, { 'content-length': '5' }),
    });

    expect(answer.bytes.toString('utf8')).toBe('bytes');
  });

  it('refuses a redirect whose answer is too large, and names that host', async () => {
    await expect(fetched('https://files.example/a.png', {
      lookup: lookups({
        'files.example': [at('93.184.216.34')],
        'cdn.example': [at('93.184.216.35')],
      }),
      request: async (url) => (url.hostname === 'files.example'
        ? answered(302, { location: 'https://cdn.example/b.png' })
        : answered(200, { 'content-length': String(32 * 1024 * 1024 + 1) })),
    })).rejects.toThrow('cdn.example answers with more than 32 MB');
  });
});

describe('a fetch gives each request the time it is allowed', () => {
  it('refuses a request that takes longer than it may', async () => {
    const said = await messageOf(fetched('https://files.example/a.png', {
      timeoutMs: 10,
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async () => await new Promise<Answer>(() => undefined),
    }));

    expect(said).toBe('files.example did not answer within 10 ms');
  });

  it('answers a request that is made in time', async () => {
    const answer = await fetched('https://files.example/a.png', {
      timeoutMs: 1000,
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async () => answered(200),
    });

    expect(answer.status).toBe(200);
  });
});

describe('a refusal names no path and no query', () => {
  const secret = 'https://files.example/a.png?token=secret';

  it('keeps the token out of a refusal of the address', async () => {
    const said = await messageOf(fetched(secret, {
      lookup: lookups({ 'files.example': [at('10.0.0.1')] }),
      request: never,
    }));

    expect(JSON.parse(said)).toEqual({ message: `${blockedAt('files.example', '10.0.0.1')}, private, loopback, link-local, or multicast address` });
    expect(said).not.toContain('secret');
    expect(said).not.toContain('a.png');
  });

  it('keeps the token out of a refusal of too many redirects', async () => {
    const said = await messageOf(fetched(secret, {
      redirects: 0,
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async () => answered(302, { location: '/again?token=secret' }),
    }));

    expect(said).toBe('files.example answers with more than 0 redirects');
    expect(said).not.toContain('secret');
    expect(said).not.toContain('a.png');
  });

  it('keeps the token out of a refusal of a redirect that is not a URL', async () => {
    const said = await messageOf(fetched(secret, {
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async () => answered(302, { location: 'https://[files.example/again?token=secret' }),
    }));

    expect(said).toBe('files.example redirects to a value that is not a URL');
    expect(said).not.toContain('secret');
  });

  it('keeps the token out of a refusal of an answer that is too large', async () => {
    const said = await messageOf(fetched(secret, {
      maxBytes: 2,
      lookup: lookups({ 'files.example': [at('93.184.216.34')] }),
      request: async () => answered(200),
    }));

    expect(said).toBe('files.example answers with more than 2 bytes');
    expect(said).not.toContain('secret');
    expect(said).not.toContain('a.png');
  });
});
