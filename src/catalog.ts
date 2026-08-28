import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { Listed } from './types/agent.js';

/**
 * The agent's sessions, as rows a host can list.
 *
 * Renames the SDK's session listing into `Listed`. The SDK is the authority
 * on which sessions exist; this module only maps the fields.
 */

/**
 * `SessionStatus`, as values.
 *
 * The protocol declares it as a `const enum`, which exists only in the type
 * system - importing it at runtime is a value import of something that was
 * erased. So the numbers are restated here, and they are the protocol's:
 * `InputNeeded` is 24 and *carries* `InProgress` (8), which is why anything
 * testing activity has to test it first.
 */
export const Status = {
  Idle: 1,
  Error: 2,
  InProgress: 8,
  InputNeeded: 24,
  IsRead: 32,
  IsArchived: 64,
} as const;

/** `ahp-session:/<uuid>`, and the SDK's id is already a uuid. */
export const uriFor = (sessionId: string): string => `ahp-session:/${sessionId}`;
export const idFor = (uri: string): string => uri.replace(/^ahp-session:\//, '');
/** Either channel of a session names the same id. */
export const idOf = (uri: string): string => uri.replace(/^ahp-(session|chat):\//, '');

/**
 * What this backend is a catalogue *of*.
 *
 * `dir`, not `cwd` - the option that scopes a listing to one project is spelled
 * `dir`, and an unrecognised key is ignored rather than refused, so the wrong
 * spelling answers with every session on the machine and looks like it worked.
 */
export async function catalogue(dir: string): Promise<Listed[]> {
  const found = await listSessions({ dir });
  return found.map((info) => ({
    id: info.sessionId,
    title: info.customTitle ?? info.summary ?? info.firstPrompt ?? 'Session',
    createdAt: new Date(info.createdAt ?? info.lastModified).toISOString(),
    modifiedAt: new Date(info.lastModified).toISOString(),
    workingDirectories: [`file://${info.cwd ?? dir}`],
  }));
}
