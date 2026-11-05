import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logoOf, LOGO_LIMIT } from '../src/logos.js';
import type { Answer } from '../src/fetch.js';
import type { LogoFetcher } from '../src/logos.js';

/*
 * The logo one piece publishes, read from the cache or fetched once, as VS
 * Code reads a remote image.
 *
 * A fetch is handed in rather than reached for, so a case answers without a
 * network and can count how many times the piece was asked for. The cases on
 * the guarded fetch hand none, and name a URL it refuses before a socket
 * opens.
 */

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ahpd-logos-')); });
afterEach(() => {
  vi.useRealTimers();
  rmSync(home, { recursive: true, force: true });
});

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

  it('takes a logo up to VS Code\'s 256 KB for an icon, and answers one line past it, caching nothing', async () => {
    expect(LOGO_LIMIT).toBe(256 * 1024);
    const atLimit = await logoOf('ap-demo', 'https://example.com/demo.png', home, fetcher(Buffer.alloc(LOGO_LIMIT, 'a'), { contentType: 'image/png' }).answer);
    expect(atLimit.problem).toBeUndefined();

    const past = await logoOf('ap-other', 'https://example.com/other.png', home, fetcher(Buffer.alloc(LOGO_LIMIT + 1, 'a'), { contentType: 'image/png' }).answer);
    expect(past).toEqual({ problem: 'the logo of ap-other is larger than 256 KB' });
    expect(existsSync(cache('ap-other'))).toBe(false);
  });

  it('gives the whole read ten seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const hanging: LogoFetcher = async () => await new Promise<Answer>(() => undefined);

    const read = logoOf('ap-demo', 'https://example.com/demo.png', home, hanging);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await read).toEqual({ problem: 'the logo of ap-demo could not be fetched: the read took longer than 10 seconds' });
  });

  it('reads through the guarded fetch: https: alone, an address in the host\'s own network refused', async () => {
    const plain = await logoOf('ap-demo', 'http://example.com/demo.png', home);
    expect(plain.problem).toBe('the logo of ap-demo could not be fetched: only an https: URL is fetched, and http: is not');

    const inside = await logoOf('ap-other', 'https://169.254.169.254/latest/meta-data/logo.png', home);
    expect(inside.problem).toBe('the logo of ap-other could not be fetched: 169.254.169.254 answers on an address that this plugin does not fetch');
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

  it('fetches each piece\'s own logo, GitHub\'s among them', async () => {
    const body = Buffer.from('the logo');
    const fake = fetcher(body, { contentType: 'image/png' });

    const logo = await logoOf('ap-github', 'https://cdn.activepieces.com/pieces/github.png', home, fake.answer);

    expect(fake.calls).toEqual(['https://cdn.activepieces.com/pieces/github.png']);
    expect(logo.icon).toEqual({ src: `data:image/png;base64,${body.toString('base64')}`, contentType: 'image/png' });
  });
});
