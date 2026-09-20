/**
 * An AHP backend over the facio agent runtime.
 *
 * ```ts
 * import { facioAgent } from '@ahpd/agent-facio';
 * createHost({ path, agents: [facioAgent({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1' })] });
 * ```
 *
 * The plugin entry that lets the daemon load it from configuration arrives in
 * task 05; this is the backend an embedder uses directly.
 */

export { facioAgent, defaultStoreRoot, modelOf, storeOf } from './agent.js';
export type { FacioOptions } from './agent.js';
export { facioSession, sessionIdOf } from './session.js';
export { mapTurn } from './mapping.js';
export type { MappedEvent, OpenRequest, TurnMapping, TurnMappingOptions } from './mapping.js';
export { facioTool, facioTools } from './tools.js';
