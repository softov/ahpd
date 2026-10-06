/**
 * The ACP bridge as an AHP backend.
 *
 * The Agent Client Protocol owns the conversation, the tools and the model
 * choice; the server behind it owns the runtime. What this package adds is the
 * AHP half, so a program that speaks ACP is a configuration line rather than a
 * package of its own.
 *
 * This file holds the backend's identity: the provider, the schema a client
 * fills in and the defaults. The session that runs a turn is `session.ts`, the
 * connection is `connection.ts`, the update mapping is `mapping.ts`, and the
 * catalogue is `catalog.ts`.
 */

import type { Agent, Bag, Listed, MachineNeed, Offered } from '@ahpd/sdk';
import { catalogueOf, deletes, forgetSession, loadedSession, stateFile } from './catalog.js';
import { acpSession } from './session.js';
import { turnsOf } from './transcript.js';
import type { AcpMachine, AcpOptions } from './types.js';

/**
 * A machine block as the needs a machine maker resolves.
 *
 * One environment need per variable, named `<provider>.<VARIABLE>`, and one copy
 * need per entry, named `<provider>.copy.<n>`, so a profile or the computer
 * plugin's `needs` can give any of them a value of its own by that name. A
 * variable is not required: a machine made without it is the agent's to
 * refuse, in its own words.
 */
const needsOf = (provider: string, machine: AcpMachine): Record<string, MachineNeed> => ({
  ...Object.fromEntries(Object.entries(machine.env ?? {}).map(([variable, value]): [string, MachineNeed] => [
    `${provider}.${variable}`,
    { name: variable, default: value, required: false, description: `${variable} for ${provider}.` },
  ])),
  ...Object.fromEntries((machine.copy ?? []).map((one, at): [string, MachineNeed] => [
    `${provider}.copy.${String(at)}`,
    { source: one.source, target: one.target, description: `Copied in for ${provider}.` },
  ])),
});

/**
 * One AHP backend over one ACP server command.
 *
 * The provider is per registration rather than per package, so two of these
 * with two commands are two backends, which is how one package serves Copilot
 * and Codex at once.
 */
export function acpAgent(options: AcpOptions): Agent {
  const provider = options.provider ?? 'acp';
  const displayName = options.displayName ?? 'ACP';

  /**
   * What a session may be told.
   *
   * One property, and no `model`: a model belongs to the turn, and ACP carries
   * the choice as a session config option the server names on `session/new`.
   * The choices reach a client through `probe` and `Session.models`, and the
   * choice itself arrives on `begin`, so advertising a model here would be a
   * second answer to a question the server already owns.
   *
   * The approvals control carries no `enum` yet, because no server has been
   * asked what modes it has. A session that has asked reports the server's own
   * ids and names in its `sessionState`, which is where a client draws them.
   */
  const schema = (): Bag => ({
    type: 'object',
    properties: {
      permissionMode: {
        scope: 'session',
        type: 'string',
        title: 'Approvals',
        description: 'How the agent handles tool approvals.',
        sessionMutable: true,
      },
    },
  });

  /**
   * What a session starts at.
   *
   * Only what was configured: a default invented for a model is a session that
   * picks a model nobody named. The model is not a schema property, but it is
   * still what a session that names none should run on, so it is defaulted
   * here and reaches the turn through `begin`.
   */
  const defaults = (): Record<string, unknown> => ({
    ...(options.model !== undefined ? { model: options.model } : {}),
  });

  return {
    provider,
    displayName,
    ...(options.description !== undefined ? { description: options.description } : {}),
    schema,
    defaults,

    /**
     * What the server offers before a session exists.
     *
     * Nothing, and that is the honest answer: ACP advertises models and
     * commands on `session/new` and in `session/update`, never on
     * `initialize`, so there is no pre-session catalogue to report. A server's
     * models are the session's to report, which is what `Session.models()` is
     * for. The method states that emptiness rather than being omitted, and no
     * server is spawned to answer it.
     */
    probe: async (): Promise<Offered> => ({ models: [], customizations: [], commands: [] }),

    /*
     * The server's own session list where it has one, and this process's record
     * where it does not. Both are read in `catalog.ts`, because the registry is
     * process-wide and outlives any one session.
     */
    list: (): Promise<Listed[]> => catalogueOf(options, provider),

    /*
     * What this process watched of a session, or what the server replays of one
     * it never watched.
     *
     * `undefined` for a session neither has: the ACP server owns the
     * conversation, so a row no server can reopen is the contract's way of
     * saying the host has no such session rather than an empty one.
     */
    transcript: async (id) => {
      const found = await loadedSession(options, provider, id);
      return found === undefined ? undefined : turnsOf(found);
    },

    // The bridge writes no per-session file, so undefined is the real answer
    // rather than a path to something that does not exist.
    stateFile,

    /**
     * Whether the server can delete a session, and asking it to.
     *
     * A getter over the capability the handshake carried, so the property is
     * absent until the server has been asked and has said yes. A server without
     * `session/delete` is not refused here - it has no delete to send, so the
     * host takes its own route and logs that the server kept its copy.
     */
    get delete() {
      return deletes(options) ? (id: string) => forgetSession(options, provider, id) : undefined;
    },

    /*
     * What a machine needs to run this agent, from the preset's own block, so
     * each variant answers for itself. Absent when the preset wrote none.
     */
    ...(options.machine === undefined ? {} : { machine: () => needsOf(provider, options.machine as AcpMachine) }),

    create: (start) => acpSession(options, start),
  };
}
