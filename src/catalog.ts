import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { Summary } from './types/catalog.js';

/**
 * The agent's sessions, as the protocol's catalogue.
 *
 * Renames the SDK's session listing into `Summary` rows. The SDK is the
 * authority on which sessions exist; this module only maps the fields.
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
 * What the host is a catalogue *of*.
 *
 * `dir`, not `cwd` - the option that scopes a listing to one project is spelled
 * `dir`, and an unrecognised key is ignored rather than refused, so the wrong
 * spelling answers with every session on the machine and looks like it worked.
 */
export async function catalogue(dir: string, flags: Map<string, number>): Promise<Summary[]> {
  const found = await listSessions({ dir });
  return found
    .map((info) => {
      const resource = uriFor(info.sessionId);
      return {
        resource,
        provider: 'claude',
        title: info.customTitle ?? info.summary ?? info.firstPrompt ?? 'Session',
        // Nothing this host started is running yet, so activity is idle and
        // the only bits set are the client's own.
        status: Status.Idle | (flags.get(resource) ?? 0),
        createdAt: new Date(info.createdAt ?? info.lastModified).toISOString(),
        modifiedAt: new Date(info.lastModified).toISOString(),
        workingDirectories: [`file://${info.cwd ?? dir}`],
      };
    })
    // The protocol says a server SHOULD order them most-recently-modified
    // first, and a client that has to sort a list it was handed is a client
    // doing the server's job.
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
