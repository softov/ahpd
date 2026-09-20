/** What this daemon was told before anybody typed a flag, and where it is. */

import { mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { PluginSpec } from '@ahpd/sdk';

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
  /**
   * Where automations are kept: `file` beside this configuration, or `memory`.
   *
   * `file` is the default and is the one with a clock in it. `memory` holds
   * definitions for the life of the process and fires nothing.
   */
  automations?: 'file' | 'memory';
  /**
   * Where the read and archived bits and a session's settings are kept: `file`
   * beside this configuration, or `memory` until the process ends.
   */
  sessions?: 'file' | 'memory';
  /** A file every frame is appended to, both directions, as JSON lines. */
  wire?: string;
  /**
   * The plugins to load, in the order they apply.
   *
   * Every entry is a package or a path, and naming one runs its code in this
   * process with this process's permissions. That makes this the one key whose
   * value is code rather than a setting, which is why the file holding it is
   * owner-readable for the same reason the token file is, and why a malformed
   * entry refuses the start rather than being skipped.
   */
  plugins?: PluginSpec[];
  /**
   * Ask npm whether a newer version exists, six hours apart. `false` never
   * asks. The daemon has no terminal, so this key is how it is switched off
   * where `--no-update-check` is not typed.
   */
  updateCheck?: boolean;
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

/**
 * Where automations are kept.
 *
 * Beside the configuration and not inside it: `config.json` is a file a person
 * edits and this one is written by the daemon every time somebody adds an
 * automation, and a tool that rewrites a hand-edited file loses the comments
 * and the ordering somebody put there.
 */
export const automationsPath = (): string => join(configDir(), 'automations.json');

/**
 * Where what this host adds on top of a backend is kept.
 *
 * The `IsRead` and `IsArchived` bits every client shares, and the settings a
 * session is running under. Beside the automations for the same reason: this
 * one is written whenever somebody archives a row, and `config.json` is a file
 * a person edits.
 */
export const sessionsPath = (): string => join(configDir(), 'sessions.json');

/**
 * Where what npm last said about this package is kept.
 *
 * Written by the daemon after it asks the registry, and read by the startup
 * line and `ahpd status` without asking again. Beside the configuration for
 * the same reason as the two above: a person edits `config.json`, and this
 * one is rewritten four times a day.
 */
export const updatePath = (): string => join(configDir(), 'update.json');

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

/**
 * One configuration entry as a `PluginSpec`, or nothing when it is not one.
 *
 * A string is the specifier on its own; an object names one and may carry the
 * options `apply` receives and whether the plugin is switched on. Anything
 * else answers `undefined` rather than a half-built spec, so the caller can
 * refuse the start with a message naming the entry instead of loading
 * something nobody wrote.
 */
export const asSpec = (value: unknown): PluginSpec | undefined => {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const held = value as Record<string, unknown>;
  if (typeof held.name !== 'string' || held.name.trim() === '') return undefined;
  if (held.options !== undefined && (typeof held.options !== 'object' || held.options === null || Array.isArray(held.options))) {
    return undefined;
  }
  if (held.enabled !== undefined && typeof held.enabled !== 'boolean') return undefined;

  const spec: PluginSpec = { name: held.name };
  if (held.options !== undefined) spec.options = held.options as Record<string, unknown>;
  if (held.enabled !== undefined) spec.enabled = held.enabled;
  return spec;
};
