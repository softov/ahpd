/**
 * The harness configuration this backend runs on.
 *
 * cofold already has a configuration a person writes once, at
 * `$XDG_CONFIG_HOME/cofold/config.json` or `~/.config/cofold/config.json`, where
 * the providers and their keys live and the model is named as
 * `<provider>/<model>`. Reading it here is what makes the plugin usable
 * without repeating a key: a daemon whose bridge names no model and is given
 * no token still runs, because the person already said where and how.
 *
 * Only the parts a backend needs are read. The rest of that file - the theme,
 * the shell, the permissions - belongs to the harness and is not this
 * package's to interpret.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** One provider as the harness configuration names it. */
export interface HarnessProvider {
  /** The id a model is written in front of, e.g. `open_router`. */
  id: string;
  /** An OpenAI-compatible base URL. */
  baseUrl: string;
  /** The key for it, when the file carries one. */
  apiKey?: string;
  /** Extra headers the endpoint needs. */
  headers?: Record<string, string>;
}

/** What this backend reads out of the harness configuration. */
export interface HarnessConfig {
  /** The providers, in the order the file lists them. */
  providers: HarnessProvider[];
  /** The model the harness runs on, as `<provider>/<model>`. */
  model?: string;
  /** The harness's own instructions, a default under the session's. */
  instructions?: string;
  /** The file it was read from, so a message can say where a value came from. */
  path: string;
}

/** The file the harness configuration lives in. */
export const harnessConfigPath = (env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string =>
  join(env['XDG_CONFIG_HOME'] ?? join(home, '.config'), 'cofold', 'config.json');

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
 */
export const harnessConfig = (env: NodeJS.ProcessEnv = process.env, home: string = homedir()): HarnessConfig => {
  const path = harnessConfigPath(env, home);
  let found: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { providers: [], path };
    found = parsed as Record<string, unknown>;
  }
  catch {
    return { providers: [], path };
  }

  const providers: HarnessProvider[] = [];
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

  const model = word(found.model);
  const instructions = word(found.instructions);
  return {
    providers,
    path,
    ...(model === undefined ? {} : { model }),
    ...(instructions === undefined ? {} : { instructions }),
  };
};

/**
 * `<provider>/<model>` as its two halves, on the first slash.
 *
 * The model id may itself carry slashes - `open_router/~deepseek/deepseek-chat`
 * names provider `open_router` and model `~deepseek/deepseek-chat` - so the
 * split is at the first one and never at the last. Nothing is returned when
 * there is no slash or nothing on one side of it, because that is a model id
 * rather than a reference.
 */
export const splitModel = (ref: string): { provider: string; modelId: string } | undefined => {
  const at = ref.indexOf('/');
  if (at <= 0 || at === ref.length - 1) return undefined;
  return { provider: ref.slice(0, at), modelId: ref.slice(at + 1) };
};
