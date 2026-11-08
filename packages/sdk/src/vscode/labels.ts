/**
 * The path shortener VS Code's agent host labels a file completion's folder
 * with, where two folders share a name.
 *
 * Vendored from VS Code's `labels.ts`, `shorten` and the constants it reads, as
 * VS Code has them. The adaptations are this package's: the default separator
 * read from Node, and an element of `paths` read once into a name so the
 * compiler sees the check that guards it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/labels.ts#L181-L324
 */

import { sep } from 'node:path';

/**
 * Shortens the paths but keeps them easy to distinguish.
 * Replaces not important parts with ellipsis.
 * Every shorten path matches only one original path and vice versa.
 *
 * Algorithm for shortening paths is as follows:
 * 1. For every path in list, find unique substring of that path.
 * 2. Unique substring along with ellipsis is shortened path of that path.
 * 3. To find unique substring of path, consider every segment of length from 1 to path.length of path from end of string
 *    and if present segment is not substring to any other paths then present segment is unique path,
 *    else check if it is not present as suffix of any other path and present segment is suffix of path itself,
 *    if it is true take present segment as unique path.
 * 4. Apply ellipsis to unique segment according to whether segment is present at start/in-between/end of path.
 */
const ellipsis = '…';
const unc = '\\\\';
const urlSchemaRegexp = /^[^:/\\?#]+?:\/\//;
const home = '~';
export function shorten(paths: string[], defaultPathSeparator: string = sep): string[] {
  const shortenedPaths: string[] = new Array(paths.length);

  // for every path
  let match = false;
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
    let pathSeparator = defaultPathSeparator;
    const originalPath = paths[pathIndex] as string;

    if (originalPath === '') {
      shortenedPaths[pathIndex] = `.${pathSeparator}`;
      continue;
    }

    if (!originalPath) {
      shortenedPaths[pathIndex] = originalPath;
      continue;
    }

    match = true;

    // trim for now and concatenate unc path (e.g. \\network) or root path (/etc, ~/etc) later
    let prefix = '';
    let trimmedPath = originalPath;
    if (urlSchemaRegexp.test(trimmedPath)) {
      prefix = trimmedPath.substr(0, trimmedPath.indexOf('//') + 2);
      trimmedPath = trimmedPath.substr(trimmedPath.indexOf('//') + 2);
      pathSeparator = '/';
    } else if (trimmedPath.indexOf(unc) === 0) {
      prefix = trimmedPath.substr(0, trimmedPath.indexOf(unc) + unc.length);
      trimmedPath = trimmedPath.substr(trimmedPath.indexOf(unc) + unc.length);
    } else if (trimmedPath.indexOf(pathSeparator) === 0) {
      prefix = trimmedPath.substr(0, trimmedPath.indexOf(pathSeparator) + pathSeparator.length);
      trimmedPath = trimmedPath.substr(trimmedPath.indexOf(pathSeparator) + pathSeparator.length);
    } else if (trimmedPath.indexOf(home) === 0) {
      prefix = trimmedPath.substr(0, trimmedPath.indexOf(home) + home.length);
      trimmedPath = trimmedPath.substr(trimmedPath.indexOf(home) + home.length);
    }

    // pick the first shortest subpath found
    const segments: string[] = trimmedPath.split(pathSeparator);
    for (let subpathLength = 1; match && subpathLength <= segments.length; subpathLength++) {
      for (let start = segments.length - subpathLength; match && start >= 0; start--) {
        match = false;
        let subpath = segments.slice(start, start + subpathLength).join(pathSeparator);

        // that is unique to any other path
        for (let otherPathIndex = 0; !match && otherPathIndex < paths.length; otherPathIndex++) {
          const otherPath = paths[otherPathIndex];

          // suffix subpath treated specially as we consider no match 'x' and 'x/...'
          if (otherPathIndex !== pathIndex && otherPath && otherPath.indexOf(subpath) > -1) {
            const isSubpathEnding: boolean = (start + subpathLength === segments.length);

            // Adding separator as prefix for subpath, such that 'endsWith(src, trgt)' considers subpath as directory name instead of plain string.
            // prefix is not added when either subpath is root directory or path[otherPathIndex] does not have multiple directories.
            const subpathWithSep: string = (start > 0 && otherPath.indexOf(pathSeparator) > -1) ? pathSeparator + subpath : subpath;
            const isOtherPathEnding: boolean = otherPath.endsWith(subpathWithSep);

            match = !isSubpathEnding || isOtherPathEnding;
          }
        }

        // found unique subpath
        if (!match) {
          let result = '';

          // preserve disk drive or root prefix
          if ((segments[0] as string).endsWith(':') || prefix !== '') {
            if (start === 1) {
              // extend subpath to include disk drive prefix
              start = 0;
              subpathLength++;
              subpath = segments[0] + pathSeparator + subpath;
            }

            if (start > 0) {
              result = segments[0] + pathSeparator;
            }

            result = prefix + result;
          }

          // add ellipsis at the beginning if needed
          if (start > 0) {
            result = result + ellipsis + pathSeparator;
          }

          result = result + subpath;

          // add ellipsis at the end if needed
          if (start + subpathLength < segments.length) {
            // If the last segment is empty, preserve the trailing slash.
            if (start + subpathLength === segments.length - 1 && segments[segments.length - 1] === '') {
              result = result + pathSeparator;
            } else {
              result = result + pathSeparator + ellipsis;
            }
          }

          shortenedPaths[pathIndex] = result;
        }
      }
    }

    if (match) {
      shortenedPaths[pathIndex] = originalPath; // use original path if no unique subpaths found
    }
  }

  return shortenedPaths;
}
