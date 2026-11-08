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

import type { Agent, Bag, Listed, MachineNeed, Offered, Session } from '@ahpd/sdk';
import { catalogueOf, deletes, findListed, forgetSession, forks, loadedSession, stateFile } from './catalog.js';
import { acpSession } from './session.js';
import type { Choice } from './session/config.js';
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
  ...(machine.part === undefined ? {} : {
    [`${provider}.part`]: { part: machine.part, required: true, description: `The ${provider} CLI, built by this host at its pinned version.` },
  }),
  ...(machine.state === undefined ? {} : {
    [`${provider}.state`]: {
      state: machine.state,
      ...(machine.seed === undefined ? {} : { seed: machine.seed }),
      description: `The ${provider} configuration, kept in a volume and seeded from this host.`,
    },
  }),
});

/**
 * One AHP backend over one ACP server command.
 *
 * The provider is per registration rather than per package, so two of these
 * with two commands are two backends, which is how one package serves Copilot
 * and Codex at once. A session is answered once its server has opened.
 */
export function acpAgent(options: AcpOptions): Agent<Promise<Session>> {
  const provider = options.provider ?? 'acp';
  const displayName = options.displayName ?? 'ACP';

  /**
   * The modes this agent lists: the preset's, refreshed from the modes the
   * last session's server reported.
   *
   * The preset's list is what a client draws before any session of this agent
   * has opened, and a session that hears its server's modes hands them here,
   * so the next session a client sets up offers what the server last named.
   * Kept in memory: the preset is the answer after a restart, and the server
   * repeats its own list on every `session/new`. A record whose `modes` is
   * `preset` keeps the preset's list, as VS Code's agents keep the modes they
   * declare.
   */
  let lastModes = (options.modes ?? []).map((one) => ({ ...one }));

  /**
   * The thinking levels each model offers, as this agent's sessions heard them.
   *
   * A server names the levels of the model it runs on, so a model's are known
   * once a session has run on it, and kept here, so every session after it
   * lists that model with them, as the modes this agent lists are refreshed
   * from the last session's server. Kept in memory: a session's server names
   * them again as it opens.
   */
  const levels = new Map<string, Choice[]>();

  /**
   * What a session may be told.
   *
   * No `model`: a model belongs to the turn, and ACP carries the choice as a
   * session config option the server names on `session/new`. The choices
   * reach a client through `probe` and `Session.models`, and the choice itself
   * arrives on `sendMessage`, so advertising a model here would be a second
   * answer to a question the server already owns.
   *
   * The approvals control carries the modes this agent lists, as its `enum`
   * and their names as its labels, so a harness nobody has found the modes for
   * keeps a text box. The modes each session's server offers are also that
   * session's own, reported as its read-only `availableApprovalModes`, as VS
   * Code's Copilot agent reports the approval modes its session may take.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotApprovalPolicy.ts#L159-L162
   *
   * Each chat keeps its own mode, as VS Code's Claude agent marks its mode
   * `chatMutable`: every chat of an ACP session is an ACP session of its own.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L2283-L2305
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
        chatMutable: true,
        ...(lastModes.length === 0 ? {} : {
          enum: lastModes.map((one) => one.id),
          enumLabels: lastModes.map((one) => one.name),
        }),
      },
      availableApprovalModes: {
        type: 'array',
        title: 'Available Permissions',
        readOnly: true,
        items: { type: 'string', title: 'Permission Mode' },
      },
    },
  });

  /**
   * What a session starts at.
   *
   * Only what was configured: a default invented for a model is a session that
   * picks a model nobody named. The model is not a schema property, but it is
   * still what a session that names none should run on, so it is defaulted
   * here and reaches the turn through `sendMessage`.
   */
  const defaults = (): Record<string, unknown> => ({
    ...(options.model !== undefined ? { model: options.model } : {}),
  });

  return {
    provider,
    displayName,
    transcriptTurnIds: 'recorded',
    ...(options.variant === true ? { variant: true } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    /*
     * A fork, offered for an agent whose server advertised `session/fork`.
     *
     * The handshake is where a server says so, a listing's or a session's, so
     * the capability is read off the last one: none until a server has spoken,
     * as VS Code's agents advertise fork only where they can fork their chats.
     * Each session's `forkPoint` then says which of its turns a fork is cut at.
     */
    get chats() {
      return forks(options) ? { fork: true } : {};
    },
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
     * One session's row, by id: this process's own record for a session it
     * watched, and otherwise one listing of this server, which is the only call
     * ACP has that describes a session at all.
     *
     * A plain property rather than a getter, unlike `delete`: it does not depend
     * on the handshake, because a server that cannot list still has the watched
     * records to answer from.
     */
    find: (id: string): Promise<Listed | undefined> => findListed(options, provider, id),

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
     * A getter over the capability the handshake carried: absent once a
     * handshake said the server keeps its sessions, so the host takes its own
     * route and logs that the server kept its copy, and a delete that reads the
     * handshake at the delete while none has been read.
     */
    get delete() {
      return deletes(options) === false ? undefined : (id: string) => forgetSession(options, provider, id);
    },

    /*
     * What a machine needs to run this agent, from the preset's own block, so
     * each variant answers for itself. Absent when the preset wrote none.
     */
    ...(options.machine === undefined ? {} : { machine: () => needsOf(provider, options.machine as AcpMachine) }),

    create: (start) => {
      /*
       * What the host wanted told and this backend cannot tell.
       *
       * An ACP server owns its system prompt, so the words a start carries
       * open the chat's first prompt as text instead, which `turn.ts` writes.
       * Said where a chat starts rather than where a turn does, so a
       * conversation of many turns says it once.
       */
      const told = start.instructions ?? [];
      if (told.length > 0) {
        options.log?.(`${provider}: ${String(told.length)} instruction(s) for the model open the first prompt, because an ACP server keeps its own system prompt`);
      }
      return acpSession(options, start, options.modesFrom === 'preset' ? undefined : (heard) => { lastModes = heard; }, levels);
    },
  };
}
