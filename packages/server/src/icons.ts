/**
 * Turning the icons a manifest or an adapter declares into what a client draws.
 *
 * A plugin names an icon as a file beside its package, such as `./icon.svg`,
 * and a client cannot read a file: what reaches it is a `data:` URI, read here
 * once rather than at each subscription. A `data:` URI is already something a
 * client can draw, so it is passed on as it is. An `https:` URL is fetched at
 * load, because a client never contacts the server a plugin names. A brand mark
 * the host ships is named as `mark:<name>` and read from the server's `icons`
 * folder, with a `<name>-dark.svg` beside it where the mark has one.
 *
 * An icon is decoration, so nothing here refuses: an icon that cannot be read,
 * fetched or is too large is dropped and said in one line, and the plugin that
 * declared it still loads. The limit is 256 KB of image, for each file, each
 * fetched body and each `data:` URI's bytes, VS Code's bound for an icon's
 * image.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexProfileImage.ts#L14-L25
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Icon } from '@ahpd/sdk';

/** The most one icon may be, in bytes of image, whether it is a file, a `data:` URI or a fetched body. */
export const ICON_LIMIT = 256 * 1024;

/**
 * The bytes of image a `data:` URI holds: its payload decoded, base64 or
 * percent-encoded, so a URI is held to the limit a file of the same image is.
 */
const dataBytes = (src: string): number => {
  const comma = src.indexOf(',');
  const payload = comma === -1 ? '' : src.slice(comma + 1);
  const header = comma === -1 ? src : src.slice(0, comma);
  if (/;base64$/i.test(header)) return Buffer.from(payload, 'base64').length;
  try { return Buffer.byteLength(decodeURIComponent(payload), 'utf8'); }
  catch { return Buffer.byteLength(payload, 'utf8'); }
};

/**
 * Where the brand marks the host ships are kept.
 *
 * Resolved beside this module rather than against the daemon's working folder,
 * as the proxy adapters resolve theirs, so a `mark:` source reads the same
 * files wherever the daemon was started.
 */
const MARK_FOLDER = fileURLToPath(new URL('../icons/', import.meta.url));

/** How long one fetch of an `https:` icon may take before the icon is given up. */
const ICON_TIMEOUT_MS = 5_000;

/** The content type each extension the host reads stands for. */
const TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/** Where one line about an icon that was dropped goes. */
export type IconProblem = (line: string) => void;

/** Whether a value is a plain record. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** One line saying what went wrong, without a stack. */
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Whether a source is one the host fetches at load rather than passes on. */
const isFetch = (src: string): boolean => /^https:/i.test(src);

/** The optional members of one icon, kept when they are the shape they should be. */
const extrasOf = (held: Record<string, unknown>): Partial<Icon> => ({
  ...(typeof held['contentType'] === 'string' ? { contentType: held['contentType'] } : {}),
  ...(Array.isArray(held['sizes']) && held['sizes'].every((one) => typeof one === 'string')
    ? { sizes: [...held['sizes']] as string[] }
    : {}),
  ...(held['theme'] === 'light' || held['theme'] === 'dark' ? { theme: held['theme'] } : {}),
});

/** Whether a path is the base folder or somewhere under it. */
const inside = (at: string, base: string): boolean => at === base || at.startsWith(base + sep);

/** Whether a name is one a mark is read by: lowercase letters, digits and `-`, so it names no folder. */
const isMarkName = (name: string): boolean => /^[a-z0-9-]+$/u.test(name);

/**
 * One mark file as a client draws it, or the line that keeps it away.
 *
 * Nothing is answered when the file is not there: the light file's absence is
 * the caller's unknown-mark line, and the dark file is optional. A file that is
 * there but cannot be drawn is a line of its own.
 */
const markOf = (name: string, theme?: 'dark'): { icon: Icon } | { problem: string } | undefined => {
  const at = resolve(MARK_FOLDER, theme === 'dark' ? `${name}-dark.svg` : `${name}.svg`);
  let found: ReturnType<typeof statSync>;
  try {
    found = statSync(at);
  }
  catch {
    return undefined;
  }
  if (!found.isFile()) return { problem: `the mark ${name} is not a file` };
  if (found.size > ICON_LIMIT) return { problem: `the mark ${name} is larger than ${ICON_LIMIT / 1024} KB` };
  let bytes: Buffer;
  try {
    bytes = readFileSync(at);
  }
  catch {
    return { problem: `the mark ${name} could not be read` };
  }
  return { icon: drawn(bytes, 'image/svg+xml', theme === undefined ? {} : { theme }) };
};

/** One icon as a client draws it, with the type it is sent as. */
const drawn = (bytes: Buffer, contentType: string, held: Partial<Icon>): Icon => {
  // An SVG is scalable, so an icon that names no size means every size.
  const sizes = held.sizes ?? (contentType === 'image/svg+xml' ? ['any'] : undefined);
  return {
    src: `data:${contentType};base64,${bytes.toString('base64')}`,
    contentType,
    ...(sizes === undefined ? {} : { sizes }),
    ...(held.theme === undefined ? {} : { theme: held.theme }),
  };
};

/**
 * The icons of a manifest or an adapter that a client can draw.
 *
 * `base` is the folder a relative `src` is resolved against: the plugin's
 * package, or the folder of a single-file plugin, which is what it has in place
 * of a package. Absent, only the two `src` forms that need no folder are kept.
 *
 * `by` names the plugin in every line `problem` receives, and each line is one
 * icon that was dropped.
 */
export function resolveIcons(icons: unknown, base: string | undefined, by: string, problem: IconProblem): Icon[] {
  if (!Array.isArray(icons)) return [];
  const kept: Icon[] = [];
  for (const held of icons) {
    if (!isRecord(held) || typeof held['src'] !== 'string' || held['src'].trim() === '') continue;
    const src = held['src'];
    const extras = extrasOf(held);

    /*
     * A mark is a brand drawing the host ships beside this module, named as
     * `mark:<name>` rather than carried by the plugin, so one WhatsApp mark
     * serves every plugin that needs it. The name is a file name and never a
     * path, and the file is held to the limit like any other icon.
     */
    if (src.startsWith('mark:')) {
      const name = src.slice('mark:'.length);
      if (!isMarkName(name)) {
        problem(`${by}: the icon ${src} is not a mark of lowercase letters, digits and -`);
        continue;
      }
      const light = markOf(name);
      if (light === undefined) {
        problem(`${by}: the mark ${name} is not one the host ships`);
        continue;
      }
      if ('problem' in light) {
        problem(`${by}: ${light.problem}`);
        continue;
      }
      kept.push(light.icon);
      // A dark file is sent beside the light one where it exists, so a mark
      // that does not read on a dark background has a second drawing.
      const dark = markOf(name, 'dark');
      if (dark !== undefined && 'icon' in dark) kept.push(dark.icon);
      else if (dark !== undefined) problem(`${by}: ${dark.problem}`);
      continue;
    }

    // Kept for `fetchIcons`, which reads it once at load: what a client
    // receives is the body as a `data:` URI, never the URL.
    if (isFetch(src)) {
      kept.push({ src, ...extras });
      continue;
    }
    if (/^data:/i.test(src)) {
      if (dataBytes(src) > ICON_LIMIT) {
        problem(`${by}: an icon is a data: URI larger than ${ICON_LIMIT / 1024} KB`);
        continue;
      }
      kept.push({ src, ...extras });
      continue;
    }

    if (base === undefined) {
      problem(`${by}: the icon ${src} has no package to be relative to`);
      continue;
    }
    // The same rule an entry is held to: a manifest cannot point its own
    // package at a file somebody else owns.
    const at = resolve(base, src);
    if (!inside(at, base)) {
      problem(`${by}: the icon ${src} points outside the plugin package`);
      continue;
    }
    /*
     * A name that resolves inside the package can still be a link to a file
     * outside it, so the real paths decide. The base is read by its real path
     * too, for a package reached through a link of its own.
     */
    let real: string;
    try {
      real = realpathSync(at);
      if (!inside(real, realpathSync(base))) {
        problem(`${by}: the icon ${src} points outside the plugin package`);
        continue;
      }
    }
    catch {
      problem(`${by}: the icon ${src} could not be read`);
      continue;
    }

    let bytes: Buffer;
    try {
      const found = statSync(real);
      if (!found.isFile()) {
        problem(`${by}: the icon ${src} is not a file`);
        continue;
      }
      if (found.size > ICON_LIMIT) {
        problem(`${by}: the icon ${src} is larger than ${ICON_LIMIT / 1024} KB`);
        continue;
      }
      bytes = readFileSync(real);
    }
    catch {
      problem(`${by}: the icon ${src} could not be read`);
      continue;
    }

    const ext = extname(at).toLowerCase();
    const contentType = extras.contentType ?? TYPES[ext];
    if (contentType === undefined) {
      problem(`${by}: the icon ${src} has no content type, and ${ext === '' ? 'its extension' : ext} is not one of ${Object.keys(TYPES).join(', ')}`);
      continue;
    }
    kept.push(drawn(bytes, contentType, extras));
  }
  return kept;
}

/**
 * Fetch one `https:` icon and turn it into the icon a client draws.
 *
 * The rules are a file's: a body over the limit, a type that is not an image and an
 * answer that fails all cost the icon and one line. A `contentType` the
 * manifest gives wins over the answer's, because the writer said what the body
 * is and the server may not.
 */
async function fetchOne(icon: Icon, by: string, problem: IconProblem, fetcher: typeof fetch): Promise<Icon | undefined> {
  let answer: Response;
  try {
    answer = await fetcher(icon.src, { signal: AbortSignal.timeout(ICON_TIMEOUT_MS) });
  }
  catch (error) {
    problem(`${by}: the icon ${icon.src} could not be fetched: ${reason(error)}`);
    return undefined;
  }
  if (!answer.ok) {
    problem(`${by}: the icon ${icon.src} could not be fetched: HTTP ${String(answer.status)}`);
    return undefined;
  }

  let bytes: Buffer;
  try {
    bytes = Buffer.from(await answer.arrayBuffer());
  }
  catch (error) {
    problem(`${by}: the icon ${icon.src} could not be read: ${reason(error)}`);
    return undefined;
  }
  if (bytes.length > ICON_LIMIT) {
    problem(`${by}: the icon ${icon.src} is larger than ${ICON_LIMIT / 1024} KB`);
    return undefined;
  }

  const contentType = icon.contentType ?? (answer.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (!contentType.startsWith('image/')) {
    problem(`${by}: the icon ${icon.src} is not an image: ${contentType === '' ? 'no content type' : contentType}`);
    return undefined;
  }
  return drawn(bytes, contentType, icon);
}

/**
 * Every `https:` icon of a manifest or an adapter, fetched and turned into a
 * `data:` URI, with the other icons kept as they are.
 *
 * The fetches run in parallel, so a slow server costs the load one timeout and
 * not one for each icon. Each icon that cannot be drawn is dropped with one
 * line `problem` receives, and the rest still go on: an icon is decoration.
 *
 * `fetcher` is a parameter so a test can answer without a network, and the same
 * argument `fetch` takes otherwise.
 */
export async function fetchIcons(
  icons: Icon[],
  by: string,
  problem: IconProblem,
  fetcher: typeof fetch = fetch,
): Promise<Icon[]> {
  const kept = await Promise.all(icons.map((icon) => (isFetch(icon.src) ? fetchOne(icon, by, problem, fetcher) : Promise.resolve<Icon | undefined>(icon))));
  return kept.filter((icon): icon is Icon => icon !== undefined);
}
