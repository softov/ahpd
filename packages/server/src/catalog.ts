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

/**
 * A URI for a session this host found on disk. `ahp-session:/<uuid>`, and the
 * SDK's id is already a uuid.
 *
 * Only for rows this host names itself. A session a *client* created is named
 * by that client, in whatever scheme it likes - see {@link idOf}.
 */
export const uriFor = (sessionId: string): string => `ahp-session:/${sessionId}`;

/**
 * The id inside a channel URI, whatever scheme the client chose.
 *
 * A channel URI is the **client's** to name and this host's to echo. VS Code
 * names a session after its provider - `claude:/<uuid>`, with the provider as
 * the *scheme* - and its terminals `agenthost-terminal:/<uuid>`. This used to
 * strip a literal `ahp-session:/` and refuse anything else, so every session
 * and every terminal VS Code opened was answered `is not a session URI`.
 *
 * So: everything after the scheme, without its leading slashes. The result is
 * an opaque key, not something to parse further.
 */
export const idOf = (uri: string): string => {
  const colon = uri.indexOf(':');
  return (colon < 0 ? uri : uri.slice(colon + 1)).replace(/^\/+/, '');
};
/** The same, and the name it goes by where a session rather than a chat is meant. */
export const idFor = idOf;

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
