/**
 * The Claude backend, as an `Agent` this host can be handed.
 *
 * One implementation of the contract `@ahpd/sdk` declares, and the only
 * thing in either package that knows what the Claude harness is: it starts the
 * agent SDK, translates its message stream into the state actions the protocol
 * describes, and reads a transcript somebody else's session left on disk.
 *
 * A host that wants a different harness registers a different `Agent` and
 * never loads this. A host that wants both registers both - `createHost` takes
 * a list, and cannot tell one from another.
 */

export { catalogue } from './catalog.js';
export { claude } from './claude.js';
export type { ClaudeOptions } from './claude.js';
export { createSession, EFFORTS, EFFORT_LABELS } from './session.js';
export type { Published } from './session.js';
export { probe } from './probe.js';
export { turnsOf } from './transcript.js';
export { protectedResource, urlOf } from './mcp.js';
