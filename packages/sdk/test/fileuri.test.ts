import { describe, expect, it } from 'vitest';
import { localPath, uriOf } from '../src/fileuri.js';

/*
 * The one reader and the one writer for `file:` URIs.
 *
 * Both are text functions - nothing here touches the filesystem - so the way
 * a URI a client sent becomes a path, and the way a path becomes the URI a
 * client reads, is decided in one place rather than in eighteen.
 */

describe('localPath', () => {
  it('decodes a URI a client sent', () => {
    expect(localPath('file:///home/a/my%20dir')).toBe('/home/a/my dir');
  });

  it('hands anything that is not a URI back unchanged, because callers get paths too', () => {
    expect(localPath('/plain/path')).toBe('/plain/path');
    expect(localPath('my dir')).toBe('my dir');
  });

  it('keeps a percent that is not an escape', () => {
    // A folder really called `100%`. There is nothing to decode, so its text
    // is the path rather than a throw: every reader this replaces read the
    // URI as text and none of them threw.
    expect(localPath('file:///a/100%')).toBe('/a/100%');
  });

  it('drops an authority, because the path is on this machine', () => {
    expect(localPath('file://host/a/b')).toBe('/a/b');
  });

  it('reads an encoded slash the same way with an authority and without one', () => {
    /*
     * `%2F` is a slash in a name, not a step up. Read as a separator,
     * `..%2F..%2F` walks out of the folder the URI names - so both branches
     * keep the text, and both answer the same path.
     */
    for (const uri of ['file:///work/..%2F..%2Fetc/passwd', 'file://x/work/..%2F..%2Fetc/passwd']) {
      const path = localPath(uri);
      expect(path).toContain('%2F');
      expect(path.split('/')).not.toContain('..');
    }
    expect(localPath('file://x/work/..%2F..%2Fetc/passwd'))
      .toBe(localPath('file:///work/..%2F..%2Fetc/passwd'));
  });

  it('never carries a NUL out of a URI, with an authority or without', () => {
    // `%00` decodes to a NUL, and a NUL is not a path: a string with one in it
    // is a comparison and a log line nothing can read, and `fs` refuses it
    // wherever it lands. The undecoded text is what is left.
    for (const uri of ['file:///work/a%00b', 'file://x/work/a%00b']) {
      expect(localPath(uri)).toBe('/work/a%00b');
    }
  });

  it('round-trips a path whose name had to be encoded', () => {
    for (const path of ['/home/a/my dir', '/home/a/has#hash', '/home/a/100%', '/home/a/café'])
      expect(localPath(uriOf(path))).toBe(path);
  });
});

describe('uriOf', () => {
  it('encodes the URI a client reads back', () => {
    expect(uriOf('/home/a/my dir')).toBe('file:///home/a/my%20dir');
  });
});
