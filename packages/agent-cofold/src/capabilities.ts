/**
 * The four `@cofold/tools` capabilities a cofold session runs itself.
 *
 * `files`, `shell`, `web` and `memory` are built by `standardCapabilities` out
 * of the `tools` section a configuration writes, and handed to the cofold agent
 * a turn runs on. cofold executes them in this process, against the machine it
 * runs on - the way the Claude backend's tools run in the Claude CLI - so ahpd
 * reports the calls, asks through the policy and reports the edits rather than
 * running anything (decision `cofold-runs-its-own-tools-in-its-process`).
 *
 * The section's shape, the search providers and the memory layout are cofold's
 * (cofold decision 123), so this file only places the run: which directory the
 * tools work in - which cofold reads from the run itself - and where memory
 * goes. A tool a host already offers keeps its name, which is what `exclude`
 * is for.
 */

import type { Capability } from '@cofold/agents';
import { standardCapabilities } from '@cofold/tools';
import type { SearchConfig, ToolsConfig } from '@cofold/tools';

export type { SearchConfig, ToolsConfig } from '@cofold/tools';

/** All four on, which is what a session whose options name no `tools` gets. */
export const DEFAULT_TOOLS: ToolsConfig = { files: true, shell: true, web: true, memory: true };

/**
 * The capabilities a session gets, in cofold's own order: files, shell, web and
 * memory, each one on unless the configuration turned it off.
 *
 * `memoryDir` is where memory files go; cofold leaves the memory capability out
 * when it is absent, which is what a session whose store is deliberately in
 * memory gets, rather than a folder under somebody's home. `taken` names the
 * tools the host already offers, which win their names: cofold refuses a run
 * two contributors give one name to, and the host's tool is the more specific
 * contribution - it was named for this deployment, and these are defaults - so
 * the capability's tool of that name is left out. A host that offers
 * `write_file` still gets the capability's other four.
 */
export function capabilitiesOf(
  tools: ToolsConfig,
  args: { workspace: string; memoryDir?: string },
  taken: Iterable<string> = [],
): Capability[] {
  const built = standardCapabilities(tools, {
    workspace: args.workspace,
    ...(args.memoryDir === undefined ? {} : { memoryDir: args.memoryDir }),
  });
  const names = [...taken];
  return names.length === 0 ? built : built.map((capability) => ({ ...capability, exclude: names }));
}

/** One value that is a plain object, or nothing for anything else. */
const bag = (value: unknown): Record<string, unknown> | undefined =>
  (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined);

/** One non-empty string, or nothing for a value this package cannot use. */
const text = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** The providers a `web.search` value names, in the order it lists them, or nothing for one that names none. */
const searchOf = (value: unknown): SearchConfig | undefined => {
  const held = bag(value);
  if (held === undefined) return undefined;
  const search: SearchConfig = {};
  for (const name of Object.keys(held)) {
    if (name === 'brave') {
      const apiKey = text(bag(held.brave)?.apiKey);
      if (apiKey !== undefined) search.brave = { apiKey };
    }
    else if (name === 'tavily') {
      const apiKey = text(bag(held.tavily)?.apiKey);
      if (apiKey !== undefined) search.tavily = { apiKey };
    }
    else if (name === 'duckduckgo' && typeof held.duckduckgo === 'boolean') {
      search.duckduckgo = held.duckduckgo;
    }
  }
  return Object.keys(search).length > 0 ? search : undefined;
};

/**
 * The `tools` option, out of whatever a configuration named.
 *
 * This is the loose reading, which `strictTools: false` asks for: every key is
 * taken only when it has the type `ToolsConfig` declares for it, so a value the
 * configuration misspelled is dropped rather than thrown over. Nothing for a
 * value that is not a plain object, and a web value that is neither a boolean
 * nor an object with a usable `search` is left out so the default stands.
 *
 * `files` is a boolean or an object carrying `requireRead`, and a `requireRead`
 * that is not a boolean is dropped, which leaves the rule on, as its default is.
 */
export const toolsOf = (value: unknown): ToolsConfig | undefined => {
  const held = bag(value);
  if (held === undefined) return undefined;
  const tools: ToolsConfig = {};
  if (typeof held.files === 'boolean') tools.files = held.files;
  else if (bag(held.files) !== undefined) {
    const requireRead = bag(held.files)?.requireRead;
    tools.files = typeof requireRead === 'boolean' ? { requireRead } : {};
  }
  if (typeof held.shell === 'boolean') tools.shell = held.shell;
  if (typeof held.memory === 'boolean') tools.memory = held.memory;
  if (typeof held.web === 'boolean') tools.web = held.web;
  else if (bag(held.web) !== undefined) {
    const search = searchOf(bag(held.web)?.search);
    tools.web = search === undefined ? {} : { search };
  }
  return tools;
};
