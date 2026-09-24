import type { Start } from './types/agent.js';

/**
 * Refuse a session that was told to run in a computer this backend cannot reach.
 *
 * A session key is the person's, and the host hands it to whichever backend was
 * named in `Start.settings`. A backend that spawns its process through the
 * host's `computers` port honours it; one that cannot - because it spawns a CLI
 * of its own, or runs in this process - must refuse rather than run on the host
 * and leave a person believing they are inside a sandbox they are not in -
 * decision `a-backend-reaches-a-computer-through-a-port`.
 */
export const refuseComputer = (start: Start, backend: string): void => {
  const said = start.settings?.computer;
  if (typeof said !== 'string' || said.trim() === '') return;
  const where = said.trim();
  if (start.computers !== undefined) return;
  throw new Error(`${backend} cannot run a session inside ${where}: only a backend that spawns through the host's computers port can. Load one that does, or create the session without a computer`);
};

/** The machine a session's settings name, or nothing. */
export const machineAsked = (start: Start): string | undefined => {
  const said = start.settings?.computer;
  return typeof said === 'string' && said.trim() !== '' ? said.trim() : undefined;
};
