/**
 * The four `@cofold/tools` capabilities a cofold session runs itself.
 *
 * `files`, `shell`, `web` and `memory` are built here, out of the package that
 * ships them, and handed to the cofold agent a turn runs on. cofold executes
 * them in this process, against the machine it runs on - the way the Claude
 * backend's tools run in the Claude CLI - so ahpd reports the calls, asks
 * through the policy and reports the edits rather than running anything
 * (decision `cofold-runs-its-own-tools-in-its-process`).
 *
 * `@cofold/tools` is what builds them rather than a copy of its tools: the
 * search providers, the path rules and the memory layout stay the harness's,
 * and this file only decides which of the four are on and where memory goes.
 */

import { join } from 'node:path';
import type { Capability, Tool } from '@cofold/agents';
import { workspaceSlug } from '@cofold/store-file';
import type { SearchProvider } from '@cofold/tools';
import { brave, duckduckgo, files, memory, shell, tavily, web } from '@cofold/tools';

/**
 * The search backends `web_search` may ask, in the order they are tried.
 *
 * The same three papo offers and in the same order: Brave and Tavily are
 * keyed services, DuckDuckGo is its results page scraped. A backend `web()`
 * was not given is simply not offered, which is why `web_search` exists only
 * when at least one of these is configured.
 */
export interface SearchConfig {
  /** Brave Search, with a subscription token. */
  brave?: { apiKey: string };
  /** Tavily, with an API key. */
  tavily?: { apiKey: string };
  /** The HTML results page, scraped; no key. */
  duckduckgo?: boolean;
}

/**
 * Which of the four capabilities a session gets.
 *
 * An absent key is on and `false` turns one off, so all four are on by default
 * and a configuration that names one turns only that one off:
 *
 * ```json
 * { "tools": { "shell": false, "web": { "search": { "duckduckgo": true } } } }
 * ```
 */
export interface ToolsConfig {
  /** `read_file`, `write_file`, `edit_file`, `list_files` and `search_files`. */
  files?: boolean;
  /** `shell_exec`, one command at a time through the platform's shell. */
  shell?: boolean;
  /** `true` is `web_fetch` alone; an object adds `web_search` over its providers. */
  web?: boolean | { search?: SearchConfig };
  /** `memory_read` and `memory_write`, under `<store root>/memory/<workspace slug>/`. */
  memory?: boolean;
}

/** All four on, which is what a session whose options name no `tools` gets. */
export const DEFAULT_TOOLS: ToolsConfig = { files: true, shell: true, web: true, memory: true };

/** The providers `web_search` is offered over, in the configuration's order. */
const searchProviders = (search: SearchConfig | undefined): SearchProvider[] => {
  const providers: SearchProvider[] = [];
  if (search?.brave !== undefined) providers.push(brave({ apiKey: search.brave.apiKey }));
  if (search?.tavily !== undefined) providers.push(tavily({ apiKey: search.tavily.apiKey }));
  if (search?.duckduckgo === true) providers.push(duckduckgo());
  return providers;
};

/**
 * A capability with the tools some other contributor already offers left out.
 *
 * cofold refuses a run whose capabilities contribute a duplicate tool name, so
 * one name has to map to one tool. The host's tool is the more specific
 * contribution - it was named for this deployment, and the plugin's options
 * are defaults - so it wins the name and the capability's tool is dropped.
 * A host that offers `write_file` still gets the capability's other four.
 */
const withoutTaken = (capability: Capability, taken: Set<string>): Capability => {
  const build = capability.tools;
  if (build === undefined) return capability;
  return {
    ...capability,
    tools: async (args) => (await build(args)).filter((tool: Tool<any, any>) => !taken.has(tool.name)),
  };
};

/**
 * The capabilities a session gets, in papo's fixed order.
 *
 * `storeRoot` is where the file store lives, so memory becomes
 * `<storeRoot>/memory/<workspace slug>/`; it is absent for a session whose
 * store is deliberately in memory, which has no directory to keep memory
 * files in, and the memory capability is left out rather than given one.
 * `taken` names the tools the host already offers, which win their names.
 */
export function capabilitiesOf(
  tools: ToolsConfig,
  args: { storeRoot: string | undefined; workspace: string },
  taken: Iterable<string> = [],
): Capability[] {
  const search = typeof tools.web === 'object' && tools.web !== null ? searchProviders(tools.web.search) : [];
  const built: Capability[] = [
    ...(tools.files !== false ? [files()] : []),
    ...(tools.shell !== false ? [shell()] : []),
    ...(tools.web !== false ? [web({ search })] : []),
    ...(tools.memory !== false && args.storeRoot !== undefined
      ? [memory({ dir: join(args.storeRoot, 'memory', workspaceSlug({ workspace: args.workspace })) })]
      : []),
  ];
  const names = new Set(taken);
  return names.size === 0 ? built : built.map((capability) => withoutTaken(capability, names));
}

/** One value that is a plain object, or nothing for anything else. */
const bag = (value: unknown): Record<string, unknown> | undefined =>
  (typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined);

/** One non-empty string, or nothing for a value this package cannot use. */
const text = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** The providers a `web.search` value names, or nothing for one that names none. */
const searchOf = (value: unknown): SearchConfig | undefined => {
  const held = bag(value);
  if (held === undefined) return undefined;
  const search: SearchConfig = {};
  const braveKey = text(bag(held.brave)?.apiKey);
  if (braveKey !== undefined) search.brave = { apiKey: braveKey };
  const tavilyKey = text(bag(held.tavily)?.apiKey);
  if (tavilyKey !== undefined) search.tavily = { apiKey: tavilyKey };
  if (typeof held.duckduckgo === 'boolean') search.duckduckgo = held.duckduckgo;
  return Object.keys(search).length > 0 ? search : undefined;
};

/**
 * The `tools` option, out of whatever a configuration named.
 *
 * Every key is taken only when it has the type `ToolsConfig` declares for it,
 * so a value the configuration misspelled is dropped rather than thrown over:
 * the plugin must not fail over an option it does not understand. Nothing for
 * a value that is not a plain object, and a web value that is neither a
 * boolean nor an object with a usable `search` is left out so the default
 * stands.
 */
export const toolsOf = (value: unknown): ToolsConfig | undefined => {
  const held = bag(value);
  if (held === undefined) return undefined;
  const tools: ToolsConfig = {};
  if (typeof held.files === 'boolean') tools.files = held.files;
  if (typeof held.shell === 'boolean') tools.shell = held.shell;
  if (typeof held.memory === 'boolean') tools.memory = held.memory;
  if (typeof held.web === 'boolean') tools.web = held.web;
  else if (bag(held.web) !== undefined) {
    const search = searchOf(bag(held.web)?.search);
    tools.web = search === undefined ? {} : { search };
  }
  return tools;
};
