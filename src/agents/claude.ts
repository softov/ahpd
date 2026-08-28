import { catalogue } from '../catalog.js';
import { probe } from '../probe.js';
import { createSession } from '../session.js';
import { turnsOf } from '../transcript.js';
import type { Bag } from '../types/common.js';
import type { Agent, Start } from '../types/agent.js';

/**
 * Claude Code, as an agent backend.
 *
 * Everything the host would otherwise have to know about one particular
 * harness: which settings it takes, where its past sessions are kept, and how
 * to start one. The host asks through `Agent` and imports none of this.
 */

/** How to build the Claude backend. */
export interface ClaudeOptions {
  /**
   * The directory its sessions live in, and the one its agents work in.
   *
   * Scopes the catalogue too: sessions outside it are neither listed nor
   * openable.
   */
  path: string;
  /** The id clients name. `claude` unless something else already is. */
  provider?: string;
}

/** Claude Code on one directory, ready to be handed to `createHost`. */
export function claude(options: ClaudeOptions): Agent {
  const dir = options.path;

  /**
   * What a session can be told to do differently.
   *
   * One schema, used by `resolveSessionConfig` (before a session exists) and
   * by every session's own state (after one does). Two copies would drift, and
   * the composer would offer one set of controls on the new-session screen and
   * a different set the moment a session opened.
   *
   * `sessionMutable` is what each row turns on: the permission mode, the model
   * and the effort level are things the CLI takes on a *running* session.
   * `thinking` is fixed when the query is built, so offering it live would be
   * a switch that flips back.
   */
  const schema = (): Bag => ({
    properties: {
      permissionMode: {
        type: 'string',
        title: 'Permissions',
        description: 'How much the agent may do before it asks.',
        enum: ['default', 'acceptEdits', 'plan', 'bypassPermissions'],
        enumLabels: ['Ask each time', 'Accept edits', 'Plan only', 'Bypass'],
        enumDescriptions: [
          'Every tool call is confirmed',
          'File edits run; commands still ask',
          'Read and reason, change nothing',
          'Nothing is confirmed',
        ],
        default: 'default',
        sessionMutable: true,
      },
      /*
       * The model is not a config property.
       *
       * A session has no model; each message has one. The choices are carried
       * on the agent (`RootState.agents[].models`) and the choice on the turn.
       * `session/configChanged` with a `model` key is still honoured, but the
       * model is not advertised here as a control of its own.
       */
      effortLevel: {
        type: 'string',
        title: 'Effort',
        description: 'How hard it thinks before answering.',
        enum: ['low', 'medium', 'high', 'xhigh', 'max'],
        enumLabels: ['Low', 'Medium', 'High', 'Very high', 'Max'],
        default: 'high',
        sessionMutable: true,
      },
      thinking: {
        type: 'string',
        title: 'Thinking',
        description: 'Fixed when the session is created.',
        enum: ['adaptive', 'disabled'],
        enumLabels: ['Adaptive', 'Off'],
        enumDescriptions: ['The agent decides when to think', 'No extended thinking'],
        default: 'adaptive',
        sessionMutable: false,
      },
    },
  });

  const defaults = (): Record<string, string> => ({
    permissionMode: 'default',
    effortLevel: 'high',
    thinking: 'adaptive',
  });

  return {
    provider: options.provider ?? 'claude',
    displayName: 'Claude Code',
    description: `The Claude Agent SDK, on ${dir}`,
    schema,
    defaults,

    probe: () => probe(dir),
    list: () => catalogue(dir),
    transcript: (id) => turnsOf(id, dir),

    create: (start: Start) => createSession({
      uri: start.uri,
      chatUri: start.chatUri,
      cwd: dir,
      settings: start.settings,
      schema: start.schema,
      emit: start.emit,
      ...(start.seedCustomizations ? { seedCustomizations: start.seedCustomizations } : {}),
      ...(start.resume !== undefined ? { resume: start.resume } : {}),
      ...(start.seed ? { seed: start.seed } : {}),
      ...(start.onHandshake ? { onHandshake: start.onHandshake } : {}),
    }),
  };
}
