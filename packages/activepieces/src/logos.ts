/**
 * The logo one Activepieces piece publishes, as the icon a client draws.
 *
 * A piece names its logo as a URL, and the plugin turns it into the `data:`
 * form a client draws, as Activepieces shows a piece with the logo its
 * `logoUrl` names. The read is VS Code's remote image read: `https:` on every
 * hop, five redirects followed by hand, ten seconds for the whole read, an
 * answer that is not an image dropped, and the size checked from
 * `content-length` and again as the bytes arrive. Each hop goes through the
 * plugin's guarded fetch, so a logo URL that resolves into the host's own
 * network is blocked as a piece's would be. A logo is held to 256 KB, VS
 * Code's bound for an icon's image.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexProfileImage.ts#L14-L25
 *
 * The fetch happens once for each piece: what it reads is kept in the daemon's
 * configuration folder, and a start after that reads the file rather than the
 * network. A logo is decoration, so a read that fails, takes too long or
 * answers something too large costs the icon and one line; it never fails the
 * load.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MOST_BYTES, WITHIN_MS, fetched } from './fetch.ts';
import type { Answer } from './fetch.ts';
import type { Icon } from '@ahpd/sdk';

/** The most one logo may be, in bytes, whether it came from the cache or the network: VS Code's 256 KB for an icon. */
export const LOGO_LIMIT = MOST_BYTES;

/** How long the whole read may take, redirects included: VS Code's ten seconds. */
const LOGO_TIMEOUT_MS = WITHIN_MS;

/** What one piece's logo came to: an icon, or the line saying why there is none. */
export interface Logo {
  /** The icon to put on the piece's adapter, when there is one. */
  icon?: Icon;
  /** One line naming the piece and what kept its logo away. */
  problem?: string;
}

/** How one logo URL is read: the guarded fetch, unless a test says otherwise. */
export type LogoFetcher = (url: string) => Promise<Answer>;

/** One line saying what went wrong, without a stack. */
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The folder a piece's logo is kept in. */
const folderOf = (dir: string): string => join(dir, 'activepieces', 'icons');

/** The extension a logo of one type is kept under. */
const extensionOf = (contentType: string): string => {
  if (contentType === 'image/svg+xml') return 'svg';
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/x-icon' || contentType === 'image/vnd.microsoft.icon') return 'ico';
  const subtype = contentType.slice(contentType.indexOf('/') + 1).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return subtype === '' ? 'png' : subtype;
};

/** The type a cached logo was kept under, read back from its extension. */
const typeOf = (extension: string): string => {
  if (extension === 'svg') return 'image/svg+xml';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'ico') return 'image/x-icon';
  return `image/${extension}`;
};

/**
 * The cached logo of one piece, if the folder holds one.
 *
 * The file is named after the extension of its type, so the type survives the
 * start that wrote it and the next start reads it back from the name.
 */
const cachedOf = (folder: string, piece: string): { at: string; contentType: string } | undefined => {
  let names: string[];
  try {
    names = readdirSync(folder);
  }
  catch {
    return undefined;
  }
  const prefix = `${piece}.`;
  const name = names.filter((one) => one.startsWith(prefix) && one.length > prefix.length).sort()[0];
  if (name === undefined) return undefined;
  return { at: join(folder, name), contentType: typeOf(name.slice(prefix.length)) };
};

/** One logo as the icon a client draws, with the type it is kept under. */
const iconOf = (bytes: Buffer, contentType: string): Icon => ({
  src: `data:${contentType};base64,${bytes.toString('base64')}`,
  contentType,
});

/** The guarded fetch, whose bounds are VS Code's on an image read. */
const guarded: LogoFetcher = async (url) => await fetched(url);

/** A read, or the refusal when the whole of it takes longer than the bound. */
const withinBound = async (read: Promise<Answer>): Promise<Answer> => {
  let late: NodeJS.Timeout | undefined;
  void read.catch(() => undefined);
  const timer = new Promise<never>((_answer, refuse) => {
    late = setTimeout(() => { refuse(new Error(`the read took longer than ${LOGO_TIMEOUT_MS / 1000} seconds`)); }, LOGO_TIMEOUT_MS);
  });
  try {
    return await Promise.race([read, timer]);
  }
  finally {
    if (late !== undefined) clearTimeout(late);
  }
};

/**
 * The icon of one piece, read from the cache or fetched once.
 *
 * `dir` is the daemon's configuration folder, which is where the cache lives.
 * Absent, there is nowhere to keep the logo, so the promise of one fetch for
 * each piece cannot be kept and no fetch is made.
 */
export async function logoOf(
  piece: string,
  url: string | undefined,
  dir: string | undefined,
  fetcher: LogoFetcher = guarded,
): Promise<Logo> {
  if (dir === undefined || dir === '') return {};
  const folder = folderOf(dir);

  const cached = cachedOf(folder, piece);
  if (cached !== undefined) {
    try {
      const bytes = readFileSync(cached.at);
      if (bytes.length <= LOGO_LIMIT) {
        return { icon: iconOf(bytes, cached.contentType) };
      }
    }
    catch {
      // A cache that cannot be read is a miss, and the URL is tried instead.
    }
  }

  if (url === undefined || url === '') return {};

  let answer: Answer;
  try {
    answer = await withinBound(fetcher(url));
  }
  catch (error) {
    return { problem: `the logo of ${piece} could not be fetched: ${reason(error)}` };
  }
  if (answer.status < 200 || answer.status >= 300) {
    return { problem: `the logo of ${piece} could not be fetched: HTTP ${String(answer.status)}` };
  }
  const contentType = (answer.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!contentType.startsWith('image/')) {
    return { problem: `the logo of ${piece} is not an image` };
  }
  if (answer.bytes.length > LOGO_LIMIT) {
    return { problem: `the logo of ${piece} is larger than ${LOGO_LIMIT / 1024} KB` };
  }

  const cache = join(folder, `${piece}.${extensionOf(contentType)}`);
  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(cache, answer.bytes);
  }
  catch (error) {
    // The icon is still drawn this time; only the next start fetches again.
    return {
      icon: iconOf(answer.bytes, contentType),
      problem: `the logo of ${piece} could not be cached: ${reason(error)}`,
    };
  }
  return { icon: iconOf(answer.bytes, contentType) };
}
