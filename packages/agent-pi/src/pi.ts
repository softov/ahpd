/**
 * pi's SDK, imported on first use.
 *
 * `@earendil-works/pi-coding-agent` takes seconds to import, and a daemon that
 * imported it with this plugin would start that much later. So every runtime
 * value this package takes from pi comes from here, through one `import()`
 * that every caller shares; the types stay static imports, which cost nothing
 * at run time.
 */

import type * as PiCodingAgent from '@earendil-works/pi-coding-agent';
import type * as PiAi from '@earendil-works/pi-ai';

/** The runtime values this package takes from pi. */
export interface Pi {
  SessionManager: typeof PiCodingAgent.SessionManager;
  /**
   * The reader pi parses a session file's lines with, which is what `list`
   * streams a file through. Taken so a caller can read a session file as it
   * lies, without `SessionManager.open` - which creates, empties and migrates
   * files rather than only reading them.
   */
  parseSessionEntries: typeof PiCodingAgent.parseSessionEntries;
  SettingsManager: typeof PiCodingAgent.SettingsManager;
  ModelRuntime: typeof PiCodingAgent.ModelRuntime;
  createAgentSessionServices: typeof PiCodingAgent.createAgentSessionServices;
  createAgentSessionFromServices: typeof PiCodingAgent.createAgentSessionFromServices;
  defineTool: typeof PiCodingAgent.defineTool;
  getAgentDir: typeof PiCodingAgent.getAgentDir;
  getSupportedThinkingLevels: typeof PiAi.getSupportedThinkingLevels;
  Type: typeof PiAi.Type;
}

/** The one import, once something has asked for it. */
let loading: Promise<Pi> | undefined;

/** pi once it has loaded, for a caller that cannot wait. */
let ready: Pi | undefined;

/**
 * pi's SDK, imported the first time this is called and shared after.
 *
 * An import that fails is not kept, so the next caller tries again rather than
 * inheriting the rejection.
 */
export function loadPi(): Promise<Pi> {
  if (loading !== undefined) return loading;
  const started = (async (): Promise<Pi> => {
    const [coding, ai] = await Promise.all([
      import('@earendil-works/pi-coding-agent'),
      import('@earendil-works/pi-ai'),
    ]);
    const pi: Pi = {
      SessionManager: coding.SessionManager,
      parseSessionEntries: coding.parseSessionEntries,
      SettingsManager: coding.SettingsManager,
      ModelRuntime: coding.ModelRuntime,
      createAgentSessionServices: coding.createAgentSessionServices,
      createAgentSessionFromServices: coding.createAgentSessionFromServices,
      defineTool: coding.defineTool,
      getAgentDir: coding.getAgentDir,
      getSupportedThinkingLevels: ai.getSupportedThinkingLevels,
      Type: ai.Type,
    };
    ready = pi;
    return pi;
  })();
  loading = started;
  started.catch(() => { if (loading === started) loading = undefined; });
  return started;
}

/** pi if it has already loaded, and nothing while it is loading or before. */
export const loadedPi = (): Pi | undefined => ready;
