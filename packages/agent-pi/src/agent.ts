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
import { catalogue, stateFile, watchedSession } from './catalog.js';
import { piSession } from './session.js';
import { turnsOf } from './transcript.js';
import type { PiOptions } from './types.js';

/**
 * One AHP backend over one embedded pi.
 *
 * `directories` is where this backend will work, which is the host's answer to
 * "may this client read that file" - so it is the daemon's own list and not
 * pi's, which has no notion of being served from somewhere.
 */
export function piAgent(options: PiOptions, directories: readonly string[]): Agent {
  const provider = options.provider ?? 'pi';
  const displayName = options.displayName ?? 'pi';
  const paths = [...directories];

  /**
   * What a session may be told.
   *
   * One property, and no `model`: a model belongs to the turn. pi carries the
   * choice per message, the list reaches a client through `Session.models` and
   * `session/modelsChanged`, and the choice itself arrives on `begin`, so a
   * `model` key here would be a second answer to a question the turn owns.
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
    },
  });

  const defaults = (): Record<string, unknown> => ({
    projectTrust: options.projectTrust ?? 'trust',
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

    /**
     * What pi offers before a session exists.
     *
     * Nothing, and that is the honest answer rather than a gap. pi's model
     * list comes from a runtime that is built with a session, against the
     * credentials and settings resolved for one directory, so a list answered
     * here would be a different list from the one a session then reports.
     * `Session.models()` and `session/modelsChanged` are where it arrives, as
     * soon as a session has been opened.
     */
    probe: async (): Promise<Offered> => ({ models: [], customizations: [], commands: [] }),

    directories: () => [...paths],

    list: (): Promise<Listed[]> => catalogue(options, provider, paths),

    transcript: async (id) => {
      const found = watchedSession(provider, id);
      return found === undefined ? undefined : turnsOf(found);
    },

    /*
     * pi writes one file per conversation, so this is a real path rather than
     * the nothing a backend without a record has to answer.
     */
    stateFile: (id, directory) => stateFile(options, id, directory),

    create: (start) => piSession(options, start),
  };
}
