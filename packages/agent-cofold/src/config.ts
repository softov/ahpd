/**
 * The harness configuration this backend runs on.
 *
 * cofold already has a configuration a person writes once, at
 * `$COFOLD_CONFIG` or `$XDG_CONFIG_HOME/cofold/config.json` or
 * `~/.config/cofold/config.json`, where the providers and their keys live and
 * the model is named as `<provider>/<model>`. Reading it here is what makes the
 * plugin usable without repeating a key: a daemon whose bridge names no model
 * and is given no token still runs, because the person already said where and
 * how.
 *
 * Only the parts a backend needs are read. The rest of that file - the theme,
 * the shell, the permissions - belongs to the harness and is not this
 * package's to interpret.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProviderConfig } from '@cofold/model-openai-compat';

/** What this backend reads out of the harness configuration. */
export interface HarnessConfig {
  /**
   * The providers, in the order the file lists them.
   *
   * Each is cofold's own `ProviderConfig`, which is what its `providers`
   * section validates against: the id a model is written in front of, an
   * OpenAI-compatible base URL, the key for it and any headers the endpoint
   * needs. Reading it is what keeps a key from being lent or repeated.
   */
  providers: ProviderConfig[];
  /** The model the harness runs on, as `<provider>/<model>`. */
  model?: string;
  /** The harness's own instructions, a default under the session's. */
  instructions?: string;
  /** The file it was read from, so a message can say where a value came from. */
  path: string;
}

/**
 * The file the harness configuration lives in.
 *
 * `COFOLD_CONFIG` names that file outright, and is what a machine sets: the
 * configuration is mounted at a fixed target under `computerConfigDir` and the
 * variable points at it, because `XDG_CONFIG_HOME` cannot be moved for this
 * one program. It is the nested host's own folder too, and a machine's mount
 * point is root-owned, so pointing it there stops any image that does not run
 * as root from starting at all.
 *
 * Without the variable it is where the harness itself would look, which is
 * `$XDG_CONFIG_HOME/cofold/config.json` or `~/.config/cofold/config.json`.
 */
export const harnessConfigPath = (env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string =>
  env['COFOLD_CONFIG']
  ?? join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'cofold', 'config.json');

/** A non-empty string, or nothing for a blank or missing one. */
const word = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * Read the harness configuration, or answer that there was none.
 *
 * A missing or unreadable file is not an error: most machines that run a
 * plugin have never run the harness, and the plugin's own options and the
 * session config are then the only sources. A file that is there and wrong
 * about one provider drops that provider rather than the whole file, so one
 * bad entry does not take the others down with it.
 *
 * `COFOLD_BASE_URL`, `COFOLD_API_KEY` and `COFOLD_MODEL` are read on top of the
 * file, as the harness itself reads them: the URL adds or replaces a provider
 * called `default`, and a model with no slash is a model of `default`. They
 * are how a machine is given a key with no file holding it.
 */
export const harnessConfig = (env: NodeJS.ProcessEnv = process.env, home: string = homedir()): HarnessConfig => {
  const path = harnessConfigPath(env, home);
  let found: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) found = parsed as Record<string, unknown>;
  }
  catch {
    // No file is no file's values; the variables below may still name a provider.
  }

  const providers: ProviderConfig[] = [];
  for (const entry of Array.isArray(found.providers) ? found.providers : []) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const held = entry as Record<string, unknown>;
    const id = word(held.id);
    const baseUrl = word(held.baseUrl);
    if (id === undefined || baseUrl === undefined) continue;
    const apiKey = word(held.apiKey);
    const headers = typeof held.headers === 'object' && held.headers !== null && !Array.isArray(held.headers)
      ? held.headers as Record<string, string>
      : undefined;
    providers.push({
      id,
      baseUrl,
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(headers === undefined ? {} : { headers }),
    });
  }

  const baseUrl = word(env['COFOLD_BASE_URL']);
  if (baseUrl !== undefined) {
    const apiKey = word(env['COFOLD_API_KEY']);
    const fromEnv: ProviderConfig = { id: 'default', baseUrl, ...(apiKey === undefined ? {} : { apiKey }) };
    providers.splice(0, providers.length, fromEnv, ...providers.filter((provider) => provider.id !== 'default'));
  }
  const named = word(env['COFOLD_MODEL']);
  const model = named === undefined ? word(found.model) : named.includes('/') ? named : `default/${named}`;
  const instructions = word(found.instructions);
  return {
    providers,
    path,
    ...(model === undefined ? {} : { model }),
    ...(instructions === undefined ? {} : { instructions }),
  };
};
