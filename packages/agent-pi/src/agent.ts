/**
 * pi as an AHP backend.
 *
 * pi brings its own agent runtime - the loop, the conversation and its tree on
 * disk, the workspace, the tools, the skills and extensions - and the way to
 * talk to it is a new one: it is a JavaScript library that constructs an
 * `AgentSession` in this process, not a protocol and not a model behind an
 * adapter. That is what makes it a package of its own rather than a
 * configuration of an existing backend - decision
 * `agent-package-only-when-it-brings-a-runtime`.
 *
 * This file holds the backend's identity: the provider, the schema a client
 * fills in and the defaults. The session that runs a turn is `session.ts`, the
 * embedded runtime is `backend.ts`, the event translation is `mapping.ts`, and
 * the catalogue is `catalog.ts`.
 */

import type { Agent, Bag, Listed, Offered } from '@ahpd/sdk';
import { runtimeModels } from './backend.js';
import type { RuntimeModels } from './backend.js';
import { catalogue, forgetSession, stateFile, watchedSession } from './catalog.js';
import { listed } from './models.js';
import { replayed } from './replay.js';
import { piSession } from './session.js';
import { turnsOf } from './transcript.js';
import type { PiOptions } from './types.js';
import { permissionModeProperty } from './types.js';

/**
 * One AHP backend over one embedded pi.
 *
 * `directories` is where this backend will work, which is the host's answer to
 * "may this client read that file" - so it is the daemon's own list and not
 * pi's, which has no notion of being served from somewhere.
 *
 * `models` is how pi's runtime models are read for the probe; the default
 * reads pi's own agent directory.
 */
export function piAgent(
  options: PiOptions,
  directories: readonly string[],
  models: RuntimeModels = runtimeModels,
): Agent {
  const provider = options.provider ?? 'pi';
  const displayName = options.displayName ?? 'pi';
  const paths = [...directories];

  /**
   * What a session may be told.
   *
   * One property, and no `model`: a model belongs to the turn. pi carries the
   * choice per message, the list reaches a client through `Session.models`,
   * and the choice itself arrives on `begin`, so a `model` key here would be a
   * second answer to a question the turn owns.
   *
   * The thinking level is not here either, for the same reason and one more:
   * it is a property of the model that was picked, so it travels in that
   * model's own `configSchema` where a client can draw it beside the model.
   */
  const schema = (): Bag => ({
    type: 'object',
    properties: {
      projectTrust: {
        scope: 'session',
        type: 'string',
        title: 'Project resources',
        description: "Whether this project's own pi extensions, skills and prompts are loaded.",
        enum: ['trust', 'deny'],
        enumLabels: ['Load them', 'Leave them'],
        default: options.projectTrust ?? 'trust',
        // The resources are read when pi opens, so a value taken after that
        // would say something the running session is not doing.
        sessionMutable: false,
      },
      /*
       * The same six modes Claude and cofold advertise, because the labels are
       * what a person reads and the harness owns the meanings - decision
       * `permission-modes-live-in-the-harness`. `default` asks before a call
       * that writes, reaches the network or destroys.
       */
      permissionMode: permissionModeProperty(),
    },
  });

  const defaults = (): Record<string, unknown> => ({
    projectTrust: options.projectTrust ?? 'trust',
    permissionMode: 'default',
  });

  return {
    provider,
    displayName,
    description: options.description ?? 'The pi coding agent, embedded in this host',
    schema,
    defaults,

    /*
     * One directory per session.
     *
     * pi's `AgentSession` is built around a single `cwd` - its tools, its
     * project resources and its session store all hang off it - so saying a
     * session can work in several would be advertising something that is not
     * there.
     */
    multipleDirectories: false,

    /*
     * A chat can be forked from one of its turns.
     *
     * A fork copies the conversation through a turn into a pi session of its
     * own - `SessionManager.createBranchedSession` - and leaves the source
     * whole, which is what AHP's `source.kind: 'fork'` asks for. There is no
     * side chat: that is a fresh conversation told what a turn said, and pi
     * has no way to hand a model context that is not in a session.
     */
    chats: { fork: true },

    /**
     * What pi offers before a session exists: the models of pi's own runtime.
     *
     * Listed as a session lists them. A provider only a project's extension
     * registers is not here, and arrives with that session's own list. A
     * runtime that cannot be built, for a credentials or models file pi cannot
     * read, answers no models rather than failing the probe.
     */
    probe: async (): Promise<Offered> => {
      let found: Offered['models'] = [];
      try { found = (await models()).map(listed); }
      catch { found = []; }
      return { models: found, customizations: [], commands: [] };
    },

    directories: () => [...paths],

    list: (): Promise<Listed[]> => catalogue(options, provider, paths),

    /*
     * What this process watched of the session, or else the session rebuilt
     * from pi's own file; nothing for an id neither has.
     */
    transcript: async (id) => {
      const found = watchedSession(provider, id);
      if (found !== undefined) return turnsOf(found);
      const rebuilt = await replayed(options, id, paths);
      return rebuilt === undefined ? undefined : turnsOf(rebuilt);
    },

    /*
     * pi writes one file per conversation, so this is a real path rather than
     * the nothing a backend without a record has to answer.
     */
    stateFile: (id, directory) => stateFile(options, id, directory),

    /*
     * pi has no delete of its own, so the file `stateFile` names goes - and
     * this process's record of the session with it, or the next listing
     * offers the row again.
     */
    delete: (id, directory) => forgetSession(options, provider, id, directory),

    create: (start) => piSession(options, start),
  };
}
