/**
 * The schemes VS Code's URL approval, its URL globs and its retained terminal
 * links name, and the test that a URI is of one of them.
 *
 * Vendored from VS Code's `network.ts`: the four `Schemas` the vendored
 * modules here reach, as an object where VS Code has a namespace, and
 * `matchesScheme` with `matchesSomeScheme`, as VS Code has them, except that
 * `matchesScheme` tells a URI from a string by its class, every URI here
 * being one this package's `URI` made.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/network.ts#L13-L197
 */

import { equalsIgnoreCase, startsWithIgnoreCase } from './strings.js';
import { URI } from './uri.js';

export const Schemas = Object.freeze({
  http: 'http',
  https: 'https',
  file: 'file',
  agentHostTerminal: 'agenthost-terminal',
});

export function matchesScheme(target: URI | string, scheme: string): boolean {
  if (target instanceof URI) {
    return equalsIgnoreCase(target.scheme, scheme);
  } else {
    return startsWithIgnoreCase(target, scheme + ':');
  }
}

export function matchesSomeScheme(target: URI | string, ...schemes: string[]): boolean {
  return schemes.some(scheme => matchesScheme(target, scheme));
}
