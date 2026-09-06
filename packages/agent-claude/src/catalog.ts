import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import type { Listed } from '@ahpd/sdk';

/**
 * Claude's own sessions, as rows a host can list.
 *
 * Renames the SDK's session listing into `Listed`. The SDK is the authority on
 * which sessions exist; this module only maps the fields - which is why it is
 * here and not beside the URI helpers in `@ahpd/sdk`: a host serving some
 * other harness has a different answer to the same question, and no reason to
 * load this one to find that out.
 */
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
