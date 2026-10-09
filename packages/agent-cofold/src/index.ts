/**
 * An AHP backend over the cofold agent runtime.
 *
 * ```ts
 * import { cofoldAgent } from '@ahpd/agent-cofold';
 * createHost({ path, agents: [cofoldAgent({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' })] });
 * ```
 *
 * The same module is the plugin the daemon loads: `apply` and `name` are what
 * the manifest's `ahpd.entry` resolves to, so naming the package in a
 * configuration is the whole install.
 */

export {
  PERMISSION_LABELS,
  cofoldAgent,
  defaultStoreRoot,
  modelOf,
  resourceOf,
  storeOf,
} from './agent.js';
export type { CofoldOptions } from './agent.js';
// The mode list, the effort levels and the configuration types are cofold's
// own: this package re-exports them, so an embedder imports them from one
// place.
export { EFFORT_LEVELS, PERMISSION_MODES, effortOf } from '@cofold/agents';
export { DEFAULT_TOOLS, toolsOf } from './capabilities.js';
export type { SearchConfig, ToolsConfig } from '@cofold/tools';
export { harnessConfig, harnessConfigPath } from './config.js';
export { splitModel } from '@cofold/model-openai-compat';
export type { HarnessConfig, HarnessProvider } from './config.js';
export { cofoldSession, sessionIdOf } from './session.js';
export { compactionNotice, mapTurn } from './mapping.js';
export type { MappedEvent, OpenRequest, TurnMapping, TurnMappingOptions } from './mapping.js';
export { cofoldTool, cofoldTools } from './tools.js';
export type { ClientToolCall, ClientToolRelay } from './tools.js';
export { turnsOf } from './transcript.js';
export type { TranscriptTurn } from './transcript.js';
export { apply, name, optionsSchema } from './plugin.js';
