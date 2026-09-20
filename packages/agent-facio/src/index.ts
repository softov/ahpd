/**
 * An AHP backend over the facio agent runtime.
 *
 * ```ts
 * import { facioAgent } from '@ahpd/agent-facio';
 * createHost({ path, agents: [facioAgent({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' })] });
 * ```
 *
 * The same module is the plugin the daemon loads: `apply` and `name` are what
 * the manifest's `ahpd.entry` resolves to, so naming the package in a
 * configuration is the whole install.
 */

export { facioAgent, defaultStoreRoot, modelOf, resourceOf, storeOf } from './agent.js';
export type { FacioOptions } from './agent.js';
export { facioSession, sessionIdOf } from './session.js';
export { mapTurn } from './mapping.js';
export type { MappedEvent, OpenRequest, TurnMapping, TurnMappingOptions } from './mapping.js';
export { facioTool, facioTools } from './tools.js';
export type { ClientToolCall, ClientToolRelay } from './tools.js';
export { turnsOf } from './transcript.js';
export type { TranscriptTurn } from './transcript.js';
export { apply, name } from './plugin.js';
