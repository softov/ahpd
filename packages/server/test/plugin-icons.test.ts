import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadPlugins, readManifest } from '../src/plugins.js';
import { resolveIcons } from '../src/icons.js';
import { webhookAdapter } from '../../webhook/src/adapter.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';
import { fileLinks } from '../../../tools/links.ts';

/*
 * The icons a manifest and an adapter carry.
 *
 * A plugin names a file beside its package, and what a client receives is the
 * same file as a `data:` URI. An `https:` URL is fetched at load and sent on
 * the same way, so a client never contacts the server a plugin names. A `data:`
 * URI is passed on as it is. An icon that cannot be read or fetched, is too
 * large, or points outside the package costs the icon and one problem line, and
 * never the plugin.
 */

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ahpd-plugin-icons-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

const base = (): HostOptions => ({ path: home, agents: [echo({ path: home })] });

/** One answer a test's fetch gives: the body, its type and the status. */
const answer = (body: string | Buffer, contentType?: string, status = 200): Response =>
  new Response(body, { status, ...(contentType === undefined ? {} : { headers: { 'content-type': contentType } }) });

/** One file under the temporary home. */
function write(rel: string, body: string | Buffer): void {
  const at = join(home, rel);
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(at, body);
}

/** One adapter a fixture plugin registers, with the icon its case names. */
const adapter = (src: string): string =>
  `host.registerAdapter({ name: 'demo', title: 'Demo', description: 'A demo.', schema: { type: 'object', properties: {} }, capabilities: [], icons: [{ src: '${src}' }], open: () => undefined });`;

/** A plugin package in the temporary home, and the spec that loads it. */
function pkg(dir: string, ahpd: Record<string, unknown>, apply = ''): string {
  write(`${dir}/package.json`, JSON.stringify({
    name: dir,
    version: '1.0.0',
    private: true,
    type: 'module',
    exports: { '.': './index.mjs' },
    ahpd: { entry: './index.mjs', ...ahpd },
  }));
  write(`${dir}/index.mjs`, `export const name = '${dir}';\nexport function apply(host) { ${apply} }\n`);
  return join(home, dir);
}

const load = (specs: PluginSpec[], fetcher?: typeof fetch) =>
  loadPlugins(specs, { base: base(), configDir: home, cwd: home, log: () => {}, ...(fetcher === undefined ? {} : { fetcher }) });

/** The `data:` URI one body is sent as. */
const dataOf = (body: string | Buffer, contentType: string): string =>
  `data:${contentType};base64,${Buffer.from(body).toString('base64')}`;

describe('ahpd.icons', () => {
  it('reads a relative SVG as a data: URI, and sizes an SVG any', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    write('icons-svg/icon.svg', svg);
    const dir = pkg('icons-svg', { description: 'One SVG icon.', icons: [{ src: './icon.svg' }] });

    const { loaded, problems } = await load([dir]);

    expect(problems).toEqual([]);
    expect(loaded[0]?.manifest?.icons).toEqual([{
      src: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
      contentType: 'image/svg+xml',
      sizes: ['any'],
    }]);
  });

  it('reads a relative PNG with its content type, and no sizes', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    write('icons-png/icon.png', png);
    const dir = pkg('icons-png', { description: 'One PNG icon.', icons: [{ src: './icon.png' }] });

    const { loaded, problems } = await load([dir]);

    expect(problems).toEqual([]);
    expect(loaded[0]?.manifest?.icons).toEqual([{
      src: `data:image/png;base64,${png.toString('base64')}`,
      contentType: 'image/png',
    }]);
  });

  it('fetches an https: SVG at load, and sends it as a data: URI', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>';
    const seen: string[] = [];
    let signal: AbortSignal | null | undefined;
    const fetcher: typeof fetch = async (input, init) => {
      seen.push(String(input));
      signal = init?.signal;
      return answer(svg, 'image/svg+xml');
    };
    const dir = pkg('icons-url', { description: 'An icon at a URL.', icons: [{ src: 'https://example.com/icon.svg', theme: 'dark' }] });

    const { loaded, problems } = await load([dir], fetcher);

    expect(problems).toEqual([]);
    expect(seen).toEqual(['https://example.com/icon.svg']);
    // A slow server must not hold the load, so the fetch carries a timeout.
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(loaded[0]?.manifest?.icons).toEqual([{
      src: dataOf(svg, 'image/svg+xml'),
      contentType: 'image/svg+xml',
      sizes: ['any'],
      theme: 'dark',
    }]);
  });

  it('fetches an https: PNG, keeping its type and no sizes', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const fetcher: typeof fetch = async () => answer(png, 'image/png');
    const dir = pkg('icons-url-png', { description: 'A PNG at a URL.', icons: [{ src: 'https://example.com/icon.png' }] });

    const { loaded, problems } = await load([dir], fetcher);

    expect(problems).toEqual([]);
    expect(loaded[0]?.manifest?.icons).toEqual([{ src: dataOf(png, 'image/png'), contentType: 'image/png' }]);
  });

  it('keeps a contentType the manifest gives over the answer\'s', async () => {
    const svg = '<svg/>';
    const fetcher: typeof fetch = async () => answer(svg, 'image/png');
    const dir = pkg('icons-url-typed', { description: 'A typed icon.', icons: [{ src: 'https://example.com/icon', contentType: 'image/svg+xml' }] });

    const { loaded, problems } = await load([dir], fetcher);

    expect(problems).toEqual([]);
    expect(loaded[0]?.manifest?.icons).toEqual([{
      src: dataOf(svg, 'image/svg+xml'),
      contentType: 'image/svg+xml',
      sizes: ['any'],
    }]);
  });

  it('drops an icon whose fetch is not ok with one line, and loads the plugin', async () => {
    const fetcher: typeof fetch = async () => answer('gone', 'text/plain', 404);
    const dir = pkg('icons-url-missing', { description: 'A missing URL icon.', icons: [{ src: 'https://example.com/nope.svg' }] });

    const { loaded, problems } = await load([dir], fetcher);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.manifest?.icons).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('could not be fetched: HTTP 404');
  });

  it('drops an icon whose fetch throws with one line, and loads the plugin', async () => {
    const fetcher: typeof fetch = async () => { throw new Error('no route'); };
    const dir = pkg('icons-url-throws', { description: 'An unreachable icon.', icons: [{ src: 'https://example.com/icon.svg' }] });

    const { loaded, problems } = await load([dir], fetcher);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.manifest?.icons).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('could not be fetched: no route');
  });

  it('drops a fetched icon over 256 KB with one line', async () => {
    const fetcher: typeof fetch = async () => answer(Buffer.alloc(257 * 1024, 'a'), 'image/svg+xml');
    const dir = pkg('icons-url-big', { description: 'A large URL icon.', icons: [{ src: 'https://example.com/icon.svg' }] });

    const { loaded, problems } = await load([dir], fetcher);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.manifest?.icons).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('larger than 256 KB');
  });

  it('drops a fetched icon that is not an image with one line', async () => {
    const fetcher: typeof fetch = async () => answer('<html></html>', 'text/html');
    const dir = pkg('icons-url-html', { description: 'An HTML icon.', icons: [{ src: 'https://example.com/icon.svg' }] });

    const { loaded, problems } = await load([dir], fetcher);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.manifest?.icons).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('is not an image: text/html');
  });

  it('passes a small data: URI through as it is', async () => {
    const dir = pkg('icons-data', { description: 'A data URI.', icons: [{ src: 'data:image/png;base64,AAAA', sizes: ['16x16'] }] });

    const { loaded, problems } = await load([dir]);

    expect(problems).toEqual([]);
    expect(loaded[0]?.manifest?.icons).toEqual([{ src: 'data:image/png;base64,AAAA', sizes: ['16x16'] }]);
  });

  /*
   * A piece's logo is often 48 to 77 KB, and up to 256 KB of image is kept, as
   * VS Code bounds an icon's image. The bound is on the image, so its base64
   * text may be longer than 256 KB.
   */
  it('passes a data: URI of 200 KB of image through, longer than 256 KB as text', async () => {
    const src = `data:image/png;base64,${Buffer.alloc(200 * 1024, 'a').toString('base64')}`;
    expect(src.length).toBeGreaterThan(256 * 1024);
    const dir = pkg('icons-logo', { description: 'A piece logo.', icons: [{ src }] });

    const { loaded, problems } = await load([dir]);

    expect(problems).toEqual([]);
    expect(loaded[0]?.manifest?.icons).toEqual([{ src }]);
  });

  it('drops a data: URI over 256 KB of image with one line, and loads the plugin', async () => {
    const src = `data:image/png;base64,${Buffer.alloc(257 * 1024, 'a').toString('base64')}`;
    const dir = pkg('icons-large-data', { description: 'A large data URI.', icons: [{ src }] });

    const { loaded, problems } = await load([dir]);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.manifest?.icons).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('data: URI larger than 256 KB');
  });

  it('drops a path outside the package with one line, and loads the plugin', async () => {
    write('outside.svg', '<svg/>');
    const dir = pkg('icons-outside', { description: 'An icon outside.', icons: [{ src: '../outside.svg' }] });

    const { loaded, problems } = await load([dir]);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.manifest?.icons).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('points outside the plugin package');
  });

  // A link to a file, which a Windows machine makes only with Developer Mode or as an administrator.
  it.skipIf(!fileLinks)('drops a symlink that points outside the package with one line, and loads the plugin', async () => {
    write('outside.svg', '<svg/>');
    write('icons-link/keep', '');
    symlinkSync(join(home, 'outside.svg'), join(home, 'icons-link', 'icon.svg'));
    const dir = pkg('icons-link', { description: 'A linked icon.', icons: [{ src: './icon.svg' }] });

    const { loaded, problems } = await load([dir]);

    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.manifest?.icons).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('points outside the plugin package');
  });

  it('drops a missing file with one line, and loads the plugin', async () => {
    const dir = pkg('icons-missing', { description: 'A missing icon.', icons: [{ src: './nope.svg' }] });

    const { loaded, problems } = await load([dir]);

    expect(loaded).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('could not be read');
  });

  it('drops a file over 256 KB with one line, and loads the plugin', async () => {
    write('icons-big/icon.svg', Buffer.alloc(257 * 1024, 'a'));
    const dir = pkg('icons-big', { description: 'A large icon.', icons: [{ src: './icon.svg' }] });

    const { loaded, problems } = await load([dir]);

    expect(loaded).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('larger than 256 KB');
  });

  it('holds an icon file and a fetched icon to the daemon\'s iconLimitBytes, 0 setting no limit', async () => {
    write('icons-limit/icon.svg', Buffer.alloc(33 * 1024, 'a'));
    const dir = pkg('icons-limit', { description: 'A large icon.', icons: [{ src: './icon.svg' }, { src: 'https://example.com/icon.svg' }] });
    const fetcher: typeof fetch = async () => answer(Buffer.alloc(33 * 1024, 'b'), 'image/svg+xml');
    const loadWithin = (limitBytes: number) => loadPlugins([dir], {
      base: base(), configDir: home, cwd: home, log: () => {}, fetcher, icons: { limitBytes, timeoutMs: 10_000 },
    });

    const none = await loadWithin(0);
    expect(none.problems).toEqual([]);
    expect(none.loaded[0]?.manifest?.icons).toHaveLength(2);

    const small = await loadWithin(16 * 1024);
    expect(small.loaded[0]?.manifest?.icons).toEqual([]);
    expect(small.problems).toHaveLength(2);
    expect(small.problems.every((line) => line.includes('larger than 16 KB'))).toBe(true);
  });

  it('drops an unknown extension with no content type, with one line', async () => {
    write('icons-unknown/icon.bin', 'not an image');
    const dir = pkg('icons-unknown', { description: 'An unknown icon.', icons: [{ src: './icon.bin' }] });

    const { loaded, problems } = await load([dir]);

    expect(loaded).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('has no content type');
  });

  it('refuses a manifest whose icons are not the shape an icon is', async () => {
    const dir = pkg('icons-bad-shape', { description: 'A bad icon.', icons: [{ theme: 'light' }] });

    const { loaded, problems } = await load([dir]);

    expect(loaded).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('ahpd.icons');
  });
});

describe('a host mark', () => {
  /** The icon of one mark file the server ships, as a client receives it. */
  const markIcon = (name: string, theme?: 'dark'): Record<string, unknown> => ({
    src: `data:image/svg+xml;base64,${readFileSync(join(import.meta.dirname, '..', 'icons', theme === 'dark' ? `${name}-dark.svg` : `${name}.svg`)).toString('base64')}`,
    contentType: 'image/svg+xml',
    sizes: ['any'],
    ...(theme === undefined ? {} : { theme }),
  });

  it('reads a mark as the server\'s file, with no package to be relative to', () => {
    const problems: string[] = [];

    const icons = resolveIcons([{ src: 'mark:whatsapp' }], undefined, 'plugin demo', (line) => problems.push(line));

    expect(problems).toEqual([]);
    expect(icons).toEqual([markIcon('whatsapp')]);
  });

  it('sends a mark\'s dark file beside its light one where the host ships both', () => {
    const problems: string[] = [];

    const icons = resolveIcons([{ src: 'mark:copilot' }], undefined, 'plugin demo', (line) => problems.push(line));

    expect(problems).toEqual([]);
    expect(icons).toEqual([markIcon('copilot'), markIcon('copilot', 'dark')]);
  });

  it('sends a dark file for the black marks of Resend and GitHub', () => {
    const problems: string[] = [];

    const icons = resolveIcons([{ src: 'mark:resend' }, { src: 'mark:github' }], undefined, 'plugin demo', (line) => problems.push(line));

    expect(problems).toEqual([]);
    expect(icons).toEqual([markIcon('resend'), markIcon('resend', 'dark'), markIcon('github'), markIcon('github', 'dark')]);
  });

  it('drops an unknown mark with one line, and loads the plugin', async () => {
    const dir = pkg('icons-mark-unknown', { description: 'An unknown mark.', icons: [{ src: 'mark:nonesuch' }] });

    const { loaded, problems } = await load([dir]);

    expect(loaded).toHaveLength(1);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('plugin icons-mark-unknown');
    expect(problems[0]).toContain('the mark nonesuch is not one the host ships');
  });

  it('drops a mark whose name is a path with one line', () => {
    const problems: string[] = [];

    const icons = resolveIcons([{ src: 'mark:../openai' }], undefined, 'plugin demo', (line) => problems.push(line));

    expect(icons).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('lowercase letters, digits and -');
  });

  it('resolves a mark a template names at load, into its icons', async () => {
    const template = "host.registerEngine({ name: 'demo', title: 'Demo', description: 'A demo engine.', schema: { type: 'object', properties: {} }, templates: [{ name: 'Demo', icon: { src: 'mark:whatsapp' }, config: { command: 'demo' } }], open: () => undefined });";
    const dir = pkg('icons-template-mark', { description: 'A template with a mark.' }, template);

    const { options, problems } = await load([dir]);

    expect(problems).toEqual([]);
    const icons = options.engines?.['demo']?.templates?.[0]?.icons;
    expect(icons).toEqual([markIcon('whatsapp')]);
    // The template keeps the mark it named, for a client that reads `icon`.
    expect(options.engines?.['demo']?.templates?.[0]?.icon).toEqual({ src: 'mark:whatsapp' });
  });
});

describe('Adapter.icons', () => {
  it('reads an adapter icon against the package of the plugin that registered it', async () => {
    write('plugin-adapter/adapter.svg', '<svg/>');
    const dir = pkg('plugin-adapter', { description: 'An adapter with an icon.' }, adapter('./adapter.svg'));

    const { options, loaded, problems } = await load([dir]);

    expect(problems).toEqual([]);
    expect(loaded).toHaveLength(1);
    expect(options.adapters?.['demo']?.icons).toEqual([{
      src: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
      contentType: 'image/svg+xml',
      sizes: ['any'],
    }]);
  });

  it('drops a bad adapter icon with one line, and still registers the adapter', async () => {
    const dir = pkg('plugin-adapter-bad', { description: 'An adapter with a bad icon.' }, adapter('./nope.svg'));

    const { options, problems } = await load([dir]);

    expect(options.adapters?.['demo']).toBeDefined();
    expect(options.adapters?.['demo']?.icons).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('could not be read');
  });

  it('fetches an https: adapter icon at load, and sends it as a data: URI', async () => {
    const svg = '<svg/>';
    const fetcher: typeof fetch = async () => answer(svg, 'image/svg+xml');
    const dir = pkg('plugin-adapter-url', { description: 'An adapter with a URL icon.' }, adapter('https://example.com/icon.svg'));

    const { options, problems } = await load([dir], fetcher);

    expect(problems).toEqual([]);
    expect(options.adapters?.['demo']?.icons).toEqual([{
      src: dataOf(svg, 'image/svg+xml'),
      contentType: 'image/svg+xml',
      sizes: ['any'],
    }]);
  });

  it('removes an adapter icon that all drop, as for a file', async () => {
    const fetcher: typeof fetch = async () => { throw new Error('no route'); };
    const dir = pkg('plugin-adapter-url-bad', { description: 'An adapter with an unreachable icon.' }, adapter('https://example.com/icon.svg'));

    const { options, problems } = await load([dir], fetcher);

    expect(options.adapters?.['demo']).toBeDefined();
    expect(options.adapters?.['demo']?.icons).toBeUndefined();
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('could not be fetched');
  });
});

describe('a single-file plugin', () => {
  it('reads the icons of the entry that names it against the folder of its file', async () => {
    write('single.svg', '<svg/>');
    write('single.mjs', 'export function apply() {}');

    const { loaded, problems } = await load([{
      id: 'single',
      source: join(home, 'single.mjs'),
      icons: [{ src: './single.svg' }],
    }]);

    expect(problems).toEqual([]);
    expect(loaded[0]?.manifest?.icons).toEqual([{
      src: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
      contentType: 'image/svg+xml',
      sizes: ['any'],
    }]);
  });
});

describe('the packages in this repository', () => {
  const REPO = join(import.meta.dirname, '../../..');

  /** The vendor marks, which carry their own colour and read on both backgrounds. */
  const VENDOR = ['activepieces', 'agent-claude', 'agent-pi'];

  /** The Lucide drawings, which ship a light and a dark variant. */
  const LUCIDE = [
    'agent-acp',
    'agent-cofold',
    'bot',
    'computer',
    'push',
    'tasks',
    'tunnel-devtunnel',
    'webhook',
  ];

  /** The one check each icon file goes through: small, and no script. */
  const wellFormed = (svg: string): void => {
    expect(Buffer.byteLength(svg, 'utf8')).toBeLessThanOrEqual(32 * 1024);
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
  };

  for (const name of VENDOR) {
    it(`${name} ships one SVG icon, and its manifest reads as data:`, () => {
      const dir = join(REPO, 'packages', name);
      const manifest = readManifest(dir);

      expect(manifest.iconProblems).toBeUndefined();
      expect(manifest.icons).toHaveLength(1);
      const icon = manifest.icons?.[0];
      expect(icon?.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
      expect(icon?.contentType).toBe('image/svg+xml');
      expect(icon?.sizes).toEqual(['any']);
      expect(icon?.theme).toBeUndefined();

      wellFormed(readFileSync(join(dir, 'icon.svg'), 'utf8'));

      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { files?: string[] };
      expect(pkg.files).toContain('icon.svg');
    });
  }

  for (const name of LUCIDE) {
    it(`${name} ships a light and a dark SVG icon, and each manifest icon reads as data:`, () => {
      const dir = join(REPO, 'packages', name);
      const manifest = readManifest(dir);

      expect(manifest.iconProblems).toBeUndefined();
      expect(manifest.icons).toHaveLength(2);
      const [light, dark] = manifest.icons ?? [];
      expect(light?.theme).toBe('light');
      expect(dark?.theme).toBe('dark');
      for (const icon of [light, dark]) {
        expect(icon?.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
        expect(icon?.contentType).toBe('image/svg+xml');
        expect(icon?.sizes).toEqual(['any']);
      }

      wellFormed(readFileSync(join(dir, 'icon.svg'), 'utf8'));
      wellFormed(readFileSync(join(dir, 'icon-dark.svg'), 'utf8'));

      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { files?: string[] };
      expect(pkg.files).toContain('icon.svg');
      expect(pkg.files).toContain('icon-dark.svg');
    });
  }

  it('gives the webhook adapter the two icons its plugin declares', () => {
    const dir = join(REPO, 'packages', 'webhook');
    const adapter = webhookAdapter(new Map());

    expect(adapter.icons).toEqual([
      { src: './icon.svg', theme: 'light' },
      { src: './icon-dark.svg', theme: 'dark' },
    ]);
    const problems: string[] = [];
    const icons = resolveIcons(adapter.icons, dir, 'plugin webhook', (line) => problems.push(line));
    expect(problems).toEqual([]);
    expect(icons).toHaveLength(2);
    expect(icons[0]?.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(icons[1]?.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });
});
