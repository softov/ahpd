/*
 * The token `--connection-token-file` names, when the folder it goes in is new.
 *
 * A start that is given a file with no token in it writes one, which is how a
 * supervisor points several processes at one secret. The folder that file goes
 * in is part of the same first run: on a machine that has never held this
 * daemon's data there is none, and a write that makes no folder ends the start.
 *
 * Each case works under its own temporary root and reads a configuration of its
 * own, so none of them touches the configuration of whoever runs the suite.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { optionsFrom, secret } from '../src/commands/options.js';
import type { Options } from '../src/commands/options.js';

let root: string;
let configFile: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-secret-'));
  configFile = join(root, 'config.json');
  writeFileSync(configFile, '{}\n');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

/** The options of a start given this token file, over a configuration of this case's own. */
const options = (connectionTokenFile: string): Options => optionsFrom({ configFile, connectionTokenFile });

describe('the token in a file', () => {
  it('writes a token into a folder that is not there yet', () => {
    // Two levels, and neither is there: `ahp-desk` keeps this file in its app
    // data folder, which a first run has not made.
    const tokenFile = join(root, 'app-data', 'ahpd', 'token');
    const { token, from } = secret(options(tokenFile));

    expect(token).toBeDefined();
    expect(token).not.toBe('');
    expect(from).toBe(`token: written to ${tokenFile}`);
    expect(existsSync(tokenFile)).toBe(true);
    expect(readFileSync(tokenFile, 'utf8').trim()).toBe(token);
  });

  it('keeps the token it wrote, so a second start reads the same one', () => {
    const tokenFile = join(root, 'app-data', 'ahpd', 'token');
    const first = secret(options(tokenFile));

    const second = secret(options(tokenFile));
    expect(second.token).toBe(first.token);
    expect(second.from).toBe(`token: read from ${tokenFile}`);
    expect(readFileSync(tokenFile, 'utf8').trim()).toBe(first.token);
  });
});

/*
 * A token is held to the characters VS Code's agent host server holds one to,
 * and refused in its words, which name where the token came from and never
 * the token.
 */
describe('a token outside 0-9, a-z, A-Z, _ and -', () => {
  it('is refused from the flag, without the token in the sentence', () => {
    const flagged = (): unknown => secret(optionsFrom({ configFile, connectionToken: 'open sesame!' }));
    expect(flagged).toThrow('The connection token from --connection-token does not adhere to the characters 0-9, a-z, A-Z, _, or -.');
    expect(secret(optionsFrom({ configFile, connectionToken: 'Open_Sesame-1' })).token).toBe('Open_Sesame-1');
  });

  it('is refused from a file, which the sentence names', () => {
    const tokenFile = join(root, 'token');
    writeFileSync(tokenFile, 'open sesame!\n');
    expect(() => secret(options(tokenFile))).toThrow(`The connection token in '${tokenFile}' does not adhere to the characters 0-9, a-z, A-Z, _, or -.`);
  });
});
