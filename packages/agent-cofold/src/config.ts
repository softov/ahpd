/**
 * The harness configuration this backend runs on.
 *
 * cofold's own app, copapo, has the configuration a person writes once, where
 * the providers and their keys live and the model is named as
 * `<provider>/<model>`. Reading it here is what makes the plugin usable without
 * repeating a key: a daemon whose bridge names no model and is given no token
 * still runs, because the person already said where and how.
 *
 * Only the parts a backend needs are read. The rest of that file - the theme,
 * the shell, the permissions - belongs to the harness and is not this
 * package's to interpret.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveConfig } from '@cofold/config';
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
  /** How much the harness has its model reason, copapo's `reasoning`: one of cofold's `EFFORT_LEVELS`. */
  reasoning?: string;
  /** The person's own file, where a message says a value belongs. */
  path: string;
}

/**
 * The person's own harness file: the one `$COPAPO_CONFIG` names, else
 * `$XDG_CONFIG_HOME/copapo/config.json`, else `~/.config/copapo/config.json`,
 * the user layer copapo's resolver reads. It is what a machine is seeded with,
 * and `COPAPO_CONFIG` is what a machine sets, pointing at the copy it mounts.
 * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/papo/src/config.ts#L126-L129
 */
export const harnessConfigPath = (env: NodeJS.ProcessEnv = process.env, home: string = homedir(), cwd: string = process.cwd()): string => {
  const named = env['COPAPO_CONFIG'];
  return named !== undefined && named !== ''
    ? resolve(cwd, named)
    : join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'copapo', 'config.json');
};

/** A non-empty string, or nothing for a blank or missing one. */
const word = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * Read the harness configuration as copapo reads it, or answer that there was
 * none.
 *
 * cofold's own resolver walks the layers under copapo's name: the person's
 * `~/.config/copapo/config.json`, the nearest `.copapo.json` at or above `cwd`,
 * and the file `$COPAPO_CONFIG` names, each merging over the one before. On top
 * of them `COPAPO_BASE_URL`, `COPAPO_API_KEY` and `COPAPO_MODEL`, or the family's
 * `COFOLD_*` where copapo's own are unset, add or replace a provider called
 * `default`, and a model with no slash is a model of `default`; they are how a
 * machine is given a key with no file holding it.
 * https://github.com/softov/cofold/blob/ee4819644696b88e83e63c56ed7bdf426d32cfb9/packages/papo/src/config.ts#L83-L124
 *
 * A layer that cannot be read is no layer's values: most machines that run a
 * plugin have never run the harness, and the plugin's own options and the
 * session config are then the only sources. A file that is there and wrong
 * about one provider drops that provider rather than the whole file, so one
 * bad entry does not take the others down with it.
 */
export const harnessConfig = (env: NodeJS.ProcessEnv = process.env, home: string = homedir(), cwd: string = process.cwd()): HarnessConfig => {
  let found: Readonly<Record<string, unknown>> = {};
  try {
    found = resolveConfig({ name: 'copapo', project: '.copapo.json', cwd, env, home }).values;
  }
  catch {
    // A layer that would not read; the variables below may still name a provider.
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

  // `COPAPO_*` over `COFOLD_*`, as copapo reads the family's variables.
  const variable = (name: string): string | undefined => word(env[`COPAPO_${name}`]) ?? word(env[`COFOLD_${name}`]);
  const baseUrl = variable('BASE_URL');
  if (baseUrl !== undefined) {
    const apiKey = variable('API_KEY');
    const fromEnv: ProviderConfig = { id: 'default', baseUrl, ...(apiKey === undefined ? {} : { apiKey }) };
    providers.splice(0, providers.length, fromEnv, ...providers.filter((provider) => provider.id !== 'default'));
  }
  const named = variable('MODEL');
  const model = named === undefined ? word(found.model) : named.includes('/') ? named : `default/${named}`;
  const instructions = word(found.instructions);
  const reasoning = word(found.reasoning);
  return {
    providers,
    path: harnessConfigPath(env, home, cwd),
    ...(model === undefined ? {} : { model }),
    ...(instructions === undefined ? {} : { instructions }),
    ...(reasoning === undefined ? {} : { reasoning }),
  };
};
