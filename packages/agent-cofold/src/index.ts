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
  EFFORT_LEVELS,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  cofoldAgent,
  defaultStoreRoot,
  effortOf,
  modelOf,
  resourceOf,
  storeOf,
} from './agent.js';
export type { CofoldOptions } from './agent.js';
export { harnessConfig, harnessConfigPath, splitModel } from './config.js';
export type { HarnessConfig, HarnessProvider } from './config.js';
export { cofoldSession, sessionIdOf } from './session.js';
export { mapTurn } from './mapping.js';
export type { MappedEvent, OpenRequest, TurnMapping, TurnMappingOptions } from './mapping.js';
export { cofoldTool, cofoldTools } from './tools.js';
export type { ClientToolCall, ClientToolRelay } from './tools.js';
export { turnsOf } from './transcript.js';
export type { TranscriptTurn } from './transcript.js';
export { apply, name } from './plugin.js';
