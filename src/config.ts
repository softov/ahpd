/** What this daemon was told before anybody typed a flag, and where it is. */

import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** What a config file may say. Every key is what a flag would have said. */
export interface Config {
  /** TCP port to bind. 0 lets the OS choose. */
  port?: number;
  /** Address to bind. */
  host?: string;
  /** The directories whose sessions this host serves. */
  paths?: string[];
  /** The secret every connection must present. */
  connectionToken?: string;
  /** A file holding that secret, written with a fresh one if absent. */
  connectionTokenFile?: string;
  /** Accept any connection, with no secret at all. */
  withoutConnectionToken?: boolean;
}

/**
 * Where this tool's files live.
 *
 * XDG, and the environment variable before the fallback: `$XDG_CONFIG_HOME` is
 * what somebody sets when their configuration is not in `~/.config`, and a
 * tool that reads the fallback anyway is a tool that ignores them.
 */
export const configHome = (): string =>
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config');

/** The directory this tool owns inside it. */
export const configDir = (): string => join(configHome(), 'ahpd');

/** The file a person edits. */
export const configPath = (): string => join(configDir(), 'config.json');

/**
 * Where a detached daemon records itself.
 *
 * Beside the configuration rather than in a runtime directory, so everything
 * about this tool is in one place a person can look at. It is written by the
 * daemon and not by hand, which is the one thing that makes it different from
 * its neighbour.
 */
export const daemonPath = (): string => join(configDir(), 'daemon.json');

/**
 * Where a detached daemon's output goes.
 *
 * It has to go somewhere real. A background process whose stdout is a pipe
 * dies the moment the thing holding the other end exits, and one whose stdout
 * is discarded leaves nothing to read when it misbehaves.
 */
export const daemonLog = (): string => join(configDir(), 'daemon.log');

/** Make sure the directory is there, so a write into it can succeed. */
export const ensureConfigDir = (): void => { mkdirSync(configDir(), { recursive: true }); };

/**
 * Read it, or answer that there was nothing to read.
 *
 * A file that is not there is not an error - most people have none. One that
 * is there and is broken *is* one, and says so rather than starting on
 * defaults nobody chose: silently ignoring a configuration somebody wrote is
 * worse than refusing to start.
 */
export function loadConfig(named?: string): Config {
  const path = named ?? configPath();
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  }
  catch {
    // Only a file asked for *by name* is worth complaining about.
    if (named === undefined) return {};
    throw new Error(`No configuration at ${named}`);
  }
  try {
    const found: unknown = JSON.parse(text);
    if (typeof found !== 'object' || found === null || Array.isArray(found)) {
      throw new Error('it is not an object');
    }
    return found as Config;
  }
  catch (error) {
    throw new Error(`${path} could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}
