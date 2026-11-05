/**
 * A `FILE` prop's value made the file a piece reads, as the engine's
 * `fileProcessor` makes it.
 *
 * A value is a base64 `data:` URI, decoded and named `unknown.<ext>` by the
 * engine's media type table; a URL, fetched, and named by its
 * `Content-Disposition`, else by its path's last segment when that holds a
 * dot, else `unknown.<ext>` by its media type; or the name of a file in the
 * session's attachments folder, which stands for Activepieces' upload and is
 * resolved inside the folder by `realpath`, so a path that leaves it is not
 * read. A prop the piece declares `streaming` is given an `ApStreamingFile`, a
 * body to read, and any other a whole `ApFile`. A value that is none of these,
 * a fetch that is not a success and a name outside the folder are no file,
 * which the validator then refuses for a required prop.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/engine/src/lib/variables/processors/file.ts
 *
 * The URL's fetch is the engine's own, under the guard that process runs with.
 */

import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import type { Prop } from './props.ts';

/** The part of an `ApFile` a piece reads. */
export interface ApFile {
  /** What the file is called. */
  filename: string;
  /** Its bytes. */
  data: Buffer;
  /** Its extension, without the dot, when there is one. */
  extension?: string;
  /** The bytes as base64, which is what a piece sends. */
  readonly base64: string;
}

/** The part of an `ApStreamingFile` a piece reads: a body to read once. */
export interface ApStreamingFile {
  filename: string;
  extension?: string;
  /** The length of the body, where it is known. */
  size?: number;
  body: Readable;
}

/** One `ApFile`, with `base64` read from its bytes. */
const apFile = (filename: string, data: Buffer, extension: string | undefined): ApFile => ({
  filename,
  data,
  ...(extension === undefined ? {} : { extension }),
  get base64(): string {
    return data.toString('base64');
  },
});

/** The extension the engine names each media type with. */
const MIME_EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/xml': 'xml',
  'application/zip': 'zip',
  'application/gzip': 'gz',
  'application/x-7z-compressed': '7z',
  'application/x-tar': 'tar',
  'application/octet-stream': 'bin',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/rtf': 'rtf',
  'application/javascript': 'js',
  'application/x-javascript': 'js',
  'application/x-yaml': 'yaml',
  'application/yaml': 'yaml',
  'application/x-httpd-php': 'php',
  'application/x-sh': 'sh',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/avif': 'avif',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/css': 'css',
  'text/csv': 'csv',
  'text/javascript': 'js',
  'text/markdown': 'md',
  'text/xml': 'xml',
  'text/tab-separated-values': 'tsv',
  'text/yaml': 'yaml',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/webm': 'weba',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'video/mpeg': 'mpeg',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-msvideo': 'avi',
  'video/ogg': 'ogv',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
};

/** The extension of a media type, by the engine's table. */
const mimeExtension = (mimeType: string): string | undefined =>
  MIME_EXTENSIONS[(mimeType.split(';')[0] ?? '').trim().toLowerCase()];

/** A file name's extension, the part after its last dot: the engine's `extensionFromFilename`. */
const extensionFromFilename = (filename: string): string | undefined => {
  const parts = filename.split('.');
  const last = parts.length > 1 ? parts.pop() : undefined;
  return last === undefined || last === '' ? undefined : last;
};

/** The characters a base64 payload holds. */
const INVALID_BASE64_CHARS = /[^A-Za-z0-9+/=]/u;

/** Whether a string is base64, its padding only at its end: the core utils' check. */
const isValidBase64String = (value: string): boolean => {
  if (value.length === 0 || value.length % 4 !== 0 || INVALID_BASE64_CHARS.test(value)) return false;
  const firstPadding = value.indexOf('=');
  return firstPadding === -1 || firstPadding === value.length - 1 || (firstPadding === value.length - 2 && value.endsWith('='));
};

/** A base64 `data:` URI's extension and bytes, or nothing for any other value: the engine's `parseBase64File`. */
const parseBase64File = (value: string): { extension: string; buffer: Buffer } | undefined => {
  const marker = value.indexOf(';base64,');
  if (!value.startsWith('data:') || marker === -1 || !isValidBase64String(value.slice(marker + ';base64,'.length))) return undefined;
  const matches = /^data:([A-Za-z-+/]+);base64,(.+)$/u.exec(value);
  if (matches === null) return undefined;
  return { extension: mimeExtension(matches[1] as string) ?? 'bin', buffer: Buffer.from(matches[2] as string, 'base64') };
};

/**
 * A fetched file's name: its `Content-Disposition`, else its path's last
 * segment when that holds a dot, else `unknown.<ext>` by its media type, the
 * engine's `getFileName`.
 */
const getFileName = (path: string, disposition: string | null, mimeType: string | undefined): string | undefined => {
  const url = new URL(path);
  if (disposition === null) {
    const last = url.pathname.split('/').pop();
    if (url.pathname.includes('/') && last !== undefined && last.includes('.')) return last;
    return `unknown.${(mimeType === undefined ? undefined : mimeExtension(mimeType)) ?? 'bin'}`;
  }
  const utf8 = /filename\*=UTF-8''([\w%\-.]+)(?:; ?|$)/iu.exec(disposition);
  if (utf8 !== null && utf8[1] !== undefined) return decodeURIComponent(utf8[1]);
  const start = disposition.toLowerCase().indexOf('filename=');
  if (start >= 0) {
    const ascii = /^filename=(["']?)(.*?[^\\])\1(?:; ?|$)/iu.exec(disposition.slice(start));
    if (ascii !== null && ascii[2] !== undefined && ascii[2] !== '') return ascii[2];
  }
  return undefined;
};

/** One URL, fetched whole: the engine's `handleUrlFile`. */
const handleUrlFile = async (value: string): Promise<ApFile | null> => {
  const response = await fetch(value);
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const filename = getFileName(value, response.headers.get('content-disposition'), response.headers.get('content-type') ?? undefined) ?? 'unknown';
  return apFile(filename, Buffer.from(await response.arrayBuffer()), extensionFromFilename(filename));
};

/** One URL, as a body to read: the engine's `handleStreamingFile`. */
const handleStreamingFile = async (value: string): Promise<ApStreamingFile | null> => {
  const parsed = parseBase64File(value);
  if (parsed !== undefined) {
    return { filename: `unknown.${parsed.extension}`, extension: parsed.extension, size: parsed.buffer.length, body: Readable.from(parsed.buffer) };
  }
  const response = await fetch(value);
  if (!response.ok || response.body === null) {
    await response.body?.cancel();
    return null;
  }
  const filename = getFileName(value, response.headers.get('content-disposition'), response.headers.get('content-type') ?? undefined) ?? 'unknown';
  const extension = extensionFromFilename(filename);
  const encoding = response.headers.get('content-encoding');
  const length = Number(response.headers.get('content-length'));
  // The size is the body's only when the body is not encoded: fetch decodes it
  // and keeps the encoded length.
  const sizeIsTrustworthy = (encoding === null || encoding.toLowerCase() === 'identity') && Number.isInteger(length) && length > 0;
  return {
    filename,
    ...(extension === undefined ? {} : { extension }),
    ...(sizeIsTrustworthy ? { size: length } : {}),
    body: Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
  };
};

/** Whether a path is inside a folder, and not merely prefixed by its name. */
const inside = (folder: string, path: string): boolean => {
  const held = relative(folder, path);
  return held !== '' && !held.startsWith('..') && !isAbsolute(held);
};

/**
 * The file one attachment name stands for, or nothing when the name leaves the
 * folder or names nothing in it. An absolute path inside the folder is the same
 * file as its name, as VS Code checks a path within a directory.
 */
const attachmentOf = async (value: string, folder: string | undefined, streaming: boolean): Promise<ApFile | ApStreamingFile | null> => {
  if (folder === undefined) return null;
  const root = await realpath(folder).catch(() => undefined);
  if (root === undefined) return null;
  const found = await realpath(isAbsolute(value) ? value : join(folder, value)).catch(() => undefined);
  if (found === undefined || !inside(root, found)) return null;
  const filename = basename(found);
  const extension = extensionFromFilename(filename);
  if (streaming) {
    return { filename, ...(extension === undefined ? {} : { extension }), size: (await stat(found)).size, body: createReadStream(found) };
  }
  return apFile(filename, await readFile(found), extension);
};

/**
 * The file one `FILE` value names, or `null` for one that names none: the
 * engine's `fileProcessor`, with an attachment's name standing for an upload.
 * `folder` is the session's attachments folder, or nothing where its store
 * keeps none.
 */
export const fileProcessor = async (prop: Prop, value: unknown, folder: string | undefined): Promise<ApFile | ApStreamingFile | null> => {
  if (typeof value !== 'string') return null;
  const streaming = prop.type === 'FILE' && prop.streaming === true;
  try {
    // A value that is no URL names an attachment; a `data:` URI is a URL.
    if (!URL.canParse(value)) return await attachmentOf(value, folder, streaming);
    if (streaming) return await handleStreamingFile(value);
    const parsed = parseBase64File(value);
    if (parsed !== undefined) return apFile(`unknown.${parsed.extension}`, parsed.buffer, parsed.extension);
    return await handleUrlFile(value);
  }
  catch (error) {
    console.error(error);
    return null;
  }
};
