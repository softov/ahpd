import type { Start } from './types/agent.js';

/**
 * Refuse a session that was told to run in a computer this backend cannot enter.
 *
 * A session key is the person's, and the host hands it to whichever backend was
 * named in `Start.settings`. A backend that spawns its process through the
 * host's `computers` port honours it, and there is exactly one of those today,
 * `@ahpd/agent-acp`. Every other backend must refuse rather than run on the
 * host and leave a person believing they are inside a sandbox they are not in -
 * decision `a-backend-reaches-a-computer-through-a-port`.
 *
 * **Having the port is not the same as using it.** The host hands `computers`
 * to every backend, because whether a machine can be reached is the host's to
 * know; whether a backend ever asks is the backend's. A gate that read the port
 * as permission let Claude Code run on the host for weeks while the session
 * said `computer://box`, which is the exact failure this exists to prevent.
 * So this refuses on the setting alone, and a backend that *can* enter a
 * machine is the one that never calls it.
 */
export const refuseComputer = (start: Start, backend: string): void => {
  const said = start.settings?.computer;
  if (typeof said !== 'string' || said.trim() === '') return;
  throw new Error(`${backend} cannot run a session inside ${said.trim()}: it spawns its own process on this host and cannot be moved into a machine. Load a backend that spawns through the host's computers port, or create the session without a computer`);
};

/** The machine a session's settings name, or nothing. */
export const machineAsked = (start: Start): string | undefined => {
  const said = start.settings?.computer;
  return typeof said === 'string' && said.trim() !== '' ? said.trim() : undefined;
};
