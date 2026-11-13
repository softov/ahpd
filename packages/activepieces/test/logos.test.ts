import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logoOf, LOGO_LIMIT, MARKS } from '../src/logos.js';
import type { Answer } from '../src/fetch.js';
import type { LogoFetcher } from '../src/logos.js';

/*
 * The logo one piece publishes, read from the cache or fetched once, as VS
 * Code reads a remote image.
 *
 * A fetch is handed in rather than reached for, so a case answers without a
 * network and can count how many times the piece was asked for. The cases on
 * the guarded fetch hand none, and name an address the guard blocks before a
 * socket opens.
 */

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ahpd-logos-')); });
afterEach(() => {
  vi.useRealTimers();
  rmSync(home, { recursive: true, force: true });
});

/** The folder the host reads a `mark:<name>` from. */
const MARK_FOLDER = fileURLToPath(new URL('../../server/icons/', import.meta.url));

/** The cache file of one piece, under the extension its type is kept as. */
const cache = (piece: string, extension = 'png'): string => join(home, 'activepieces', 'icons', `${piece}.${extension}`);

/** A fake fetch that answers one image, and counts the calls. */
function fetcher(body: Buffer, init: { status?: number; contentType?: string } = {}): { calls: string[]; answer: LogoFetcher } {
  const calls: string[] = [];
  const answer: LogoFetcher = async (url) => {
    calls.push(url);
    const answered: Answer = {
      status: init.status ?? 200,
      headers: init.contentType === undefined ? {} : { 'content-type': init.contentType },
      bytes: body,
    };
    return answered;
  };
  return { calls, answer };
}

describe('logoOf', () => {
  it('reads a cached logo without a fetch', async () => {
    const body = Buffer.from('a cached logo');
    mkdirSync(join(home, 'activepieces', 'icons'), { recursive: true });
    writeFileSync(cache('ap-demo'), body);
    const fake = fetcher(Buffer.from('never'));

    const logo = await logoOf('ap-demo', 'https://example.com/demo.png', home, fake.answer);

    expect(fake.calls).toEqual([]);
    expect(logo.problem).toBeUndefined();
    expect(logo.icon).toEqual({ src: `data:image/png;base64,${body.toString('base64')}`, contentType: 'image/png' });
  });

  it('fetches a logo once, keeps it, and reads the cache after that', async () => {
    const body = Buffer.from('the logo');
    const fake = fetcher(body, { contentType: 'image/svg+xml' });

    const first = await logoOf('ap-demo', 'https://example.com/demo.svg', home, fake.answer);
    expect(first.problem).toBeUndefined();
    expect(first.icon).toEqual({ src: `data:image/svg+xml;base64,${body.toString('base64')}`, contentType: 'image/svg+xml' });
    expect(readFileSync(cache('ap-demo', 'svg'))).toEqual(body);

    const again = fetcher(Buffer.from('never'));
    const second = await logoOf('ap-demo', 'https://example.com/demo.svg', home, again.answer);
    expect(again.calls).toEqual([]);
    expect(second.icon).toBeDefined();
  });

  it('reads a cached SVG back as image/svg+xml, from the extension of its name', async () => {
    const body = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    mkdirSync(join(home, 'activepieces', 'icons'), { recursive: true });
    writeFileSync(cache('ap-demo', 'svg'), body);
    const fake = fetcher(Buffer.from('never'));

    const logo = await logoOf('ap-demo', 'https://example.com/demo.svg', home, fake.answer);

    expect(fake.calls).toEqual([]);
    expect(logo.problem).toBeUndefined();
    expect(logo.icon).toEqual({ src: `data:image/svg+xml;base64,${body.toString('base64')}`, contentType: 'image/svg+xml' });
  });

  it('drops an answer that is not an image, as VS Code drops one, and caches nothing', async () => {
    const fake = fetcher(Buffer.from('<html><body>not an image</body></html>'), { contentType: 'text/html' });

    const logo = await logoOf('ap-demo', 'https://example.com/demo', home, fake.answer);

    expect(logo).toEqual({ problem: 'the logo of ap-demo is not an image' });
    expect(existsSync(cache('ap-demo'))).toBe(false);
  });

  it('answers no icon and one line when the fetch is not ok', async () => {
    const fake = fetcher(Buffer.from('gone'), { status: 404 });

    const logo = await logoOf('ap-demo', 'https://example.com/demo.png', home, fake.answer);

    expect(logo.icon).toBeUndefined();
    expect(logo.problem).toContain('HTTP 404');
    expect(existsSync(cache('ap-demo'))).toBe(false);
  });

  it('answers no icon and one line when the fetch throws', async () => {
    const failing: LogoFetcher = async () => { throw new Error('the CDN is down'); };

    const logo = await logoOf('ap-demo', 'https://example.com/demo.png', home, failing);

    expect(logo.icon).toBeUndefined();
    expect(logo.problem).toContain('the CDN is down');
  });

  // Upstream's 32 KB (plan plugin/58, Softov 2026-10-24): a logo travels in
  // the adapters list every client receives in full.
  it('takes a logo up to 32 KB, and answers one line past it, caching nothing', async () => {
    expect(LOGO_LIMIT).toBe(32 * 1024);
    const atLimit = await logoOf('ap-demo', 'https://example.com/demo.png', home, fetcher(Buffer.alloc(LOGO_LIMIT, 'a'), { contentType: 'image/png' }).answer);
    expect(atLimit.problem).toBeUndefined();

    const past = await logoOf('ap-other', 'https://example.com/other.png', home, fetcher(Buffer.alloc(LOGO_LIMIT + 1, 'a'), { contentType: 'image/png' }).answer);
    expect(past).toEqual({ problem: 'the logo of ap-other is larger than 32 KB' });
    expect(existsSync(cache('ap-other'))).toBe(false);
  });

  it('holds a logo to the logoLimitBytes option, 0 setting no limit', async () => {
    const big = Buffer.alloc(40 * 1024, 'a');
    const none = await logoOf('ap-none', 'https://example.com/none.png', home, fetcher(big, { contentType: 'image/png' }).answer, { limitBytes: 0, timeoutMs: 10_000 });
    expect(none.problem).toBeUndefined();
    expect(none.icon).toBeDefined();
    const small = await logoOf('ap-small', 'https://example.com/small.png', home, fetcher(big, { contentType: 'image/png' }).answer, { limitBytes: 16 * 1024, timeoutMs: 10_000 });
    expect(small).toEqual({ problem: 'the logo of ap-small is larger than 16 KB' });
  });

  it('gives the whole read ten seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hanging: LogoFetcher = async () => await new Promise<Answer>(() => undefined);

    const read = logoOf('ap-demo', 'https://example.com/demo.png', home, hanging);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await read).toEqual({ problem: 'the logo of ap-demo could not be fetched: the read took longer than 10 seconds' });
  });

  it('reads through the guarded fetch: https: alone, an address that is not unicast blocked', async () => {
    const plain = await logoOf('ap-demo', 'http://example.com/demo.png', home);
    expect(plain.problem).toBe('the logo of ap-demo could not be fetched: only an https: URL is fetched, and http: is not');

    const inside = await logoOf('ap-other', 'https://169.254.169.254/latest/meta-data/logo.png', home);
    expect(inside.problem).toContain('SSRF protection: refusing to connect to 169.254.169.254 (resolved 169.254.169.254)');
  });

  it('makes no fetch when there is nowhere to cache', async () => {
    const fake = fetcher(Buffer.from('never'));

    const logo = await logoOf('ap-demo', 'https://example.com/demo.png', undefined, fake.answer);

    expect(logo).toEqual({});
    expect(fake.calls).toEqual([]);
  });

  it('answers nothing when the piece publishes no logo', async () => {
    const fake = fetcher(Buffer.from('never'));

    const logo = await logoOf('ap-demo', undefined, home, fake.answer);

    expect(logo).toEqual({});
    expect(fake.calls).toEqual([]);
  });

  it('fetches the own logo of a piece with no host mark', async () => {
    expect(MARKS['ap-airtable']).toBeUndefined();
    const body = Buffer.from('the logo');
    const fake = fetcher(body, { contentType: 'image/png' });

    const logo = await logoOf('ap-airtable', 'https://cdn.activepieces.com/pieces/airtable.png', home, fake.answer);

    expect(fake.calls).toEqual(['https://cdn.activepieces.com/pieces/airtable.png']);
    expect(logo.icon).toEqual({ src: `data:image/png;base64,${body.toString('base64')}`, contentType: 'image/png' });
  });

  it('answers the host mark of a piece in the table, before the cache and the CDN', async () => {
    // A cached logo and a fetch that fails the case: the mark wins over both.
    mkdirSync(join(home, 'activepieces', 'icons'), { recursive: true });
    writeFileSync(cache('ap-whatsapp'), Buffer.from('a cached logo'));
    const failing: LogoFetcher = async () => { throw new Error('a marked piece must not fetch'); };

    for (const [piece, mark] of Object.entries(MARKS)) {
      const logo = await logoOf(piece, `https://cdn.activepieces.com/pieces/${piece}.png`, home, failing);
      expect(logo, piece).toEqual({ icon: { src: `mark:${mark}` } });
    }
    // A daemon with no configuration folder still sends the mark.
    expect(await logoOf('ap-postgres', 'https://cdn.activepieces.com/pieces/postgres.png', undefined, failing))
      .toEqual({ icon: { src: 'mark:postgres' } });
  });

  it('names only marks the host ships, the pieces whose logos are over the limit among them', () => {
    expect(Object.keys(MARKS)).toEqual(expect.arrayContaining(['ap-jira-cloud', 'ap-linear', 'ap-postgres', 'ap-resend', 'ap-whatsapp']));
    for (const mark of Object.values(MARKS)) {
      expect(existsSync(join(MARK_FOLDER, `${mark}.svg`)), mark).toBe(true);
    }
  });
});
