import { isAbsolute, relative } from 'node:path';

/**
 * Whether a path is a served root or under one.
 *
 * By `relative` rather than by string: `startsWith(root + '/')` is wrong for
 * `/` - it asks whether the path begins `//` and refuses the whole filesystem -
 * and `root === path` alone is wrong for everything else. Three places check
 * this and they used to do it three ways, of which one was exact equality: a
 * host told to serve `/home/you` served that directory and refused every
 * project inside it, which is the only kind of directory anybody opens.
 *
 * Textual, so callers that can resolve symlinks resolve first and pass the
 * real path - `served/link` pointing at `/etc` passes any textual test.
 */
export const within = (root: string, path: string): boolean => {
  const step = relative(root, path);
  return step === '' || (!step.startsWith('..') && !isAbsolute(step));
};
