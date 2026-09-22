/**
 * An AHP backend over the Agent Client Protocol.
 *
 * ```ts
 * import { acpAgent } from '@ahpd/agent-acp';
 * createHost({ path, agents: [acpAgent({ provider: 'copilot', command: 'copilot', args: ['--acp'] })] });
 * ```
 *
 * The same package is what a daemon loads as a plugin, so naming the command
 * in a configuration is the whole install.
 */

export { acpAgent } from './agent.js';
export { catalogueOf, stateFile, watchedRows, watchSession } from './catalog.js';
export { connectAcp } from './connection.js';
export { mapUpdate } from './mapping.js';
export { apply, name, title } from './plugin.js';
export { acpSession } from './session.js';
export { turnsOf } from './transcript.js';
export type { TranscriptTurn } from './transcript.js';
export type {
  AcpCall,
  AcpConnection,
  AcpConnectionOptions,
  AcpHandlers,
  AcpOptions,
  AcpTurn,
  PermissionAnswer,
  WatchedSession,
  WatchedTurn,
} from './types.js';
