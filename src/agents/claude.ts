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
   * The directories it will work in, and the ones it lists.
   *
   * The first is where a session goes when the client names none. A client
   * may name any of the others and nothing else: a host that ran the agent
   * wherever it was told is one anybody who can reach the port can point at
   * any directory on the machine.
   *
   * This is also the catalogue's scope, so a directory left out is one whose
   * sessions are neither listed nor openable.
   */
  paths: string[];
  /** The id clients name. `claude` unless something else already is. */
  provider?: string;
}

/** Claude Code on one or more directories, ready to be handed to `createHost`. */
export function claude(options: ClaudeOptions): Agent {
  const dirs = options.paths;
  const dir = dirs[0];
  if (dir === undefined)
    throw new Error('claude() needs at least one directory to work in.');

  /**
   * Which directory a session goes in.
   *
   * Named, or the first. Anything else is refused rather than quietly
   * replaced - a directory accepted and then ignored is a session running
   * somewhere nobody asked for, with nothing on screen to say so.
   */
  const workingDirectory = (asked?: string): string => {
    if (asked === undefined)
      return dir;
    const found = dirs.find((served) => served === asked);
    if (found === undefined) {
      throw new Error(
        `This host does not serve ${asked}. It serves ${dirs.join(', ')}.`,
      );
    }
    return found;
  };

  /*
   * What the probe learned about output styles.
   *
   * The schema is otherwise fixed, but this one property's choices belong to
   * the harness rather than to the protocol - a person's own styles live in
   * their settings - so it is learned once at startup, the way models are,
   * and the control is simply absent until it is known.
   */
  let styles: string[] = [];
  let style: string | undefined;

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
      // Learned, so absent until the probe has answered and absent for good
      // on a harness that has no styles.
      ...(styles.length > 0
        ? {
            outputStyle: {
              type: 'string',
              title: 'Output style',
              description: 'The voice it answers in.',
              enum: styles,
              enumLabels: styles.map((name) => name.charAt(0).toUpperCase() + name.slice(1)),
              ...(style !== undefined ? { default: style } : {}),
              sessionMutable: true,
            },
          }
        : {}),
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
    ...(style !== undefined ? { outputStyle: style } : {}),
  });

  return {
    provider: options.provider ?? 'claude',
    displayName: 'Claude Code',
    description: `The Claude Agent SDK, on ${dirs.join(', ')}`,
    schema,
    defaults,

    directories: () => [...dirs],

    // The styles are kept as well as handed on: `schema()` is asked before any
    // session exists, and it can only offer what has already been learned.
    probe: async () => {
      const offered = await probe(dir);
      styles = offered.outputStyles ?? [];
      style = offered.outputStyle;
      return offered;
    },

    // Every directory it serves, as one list. A session is listed by the
    // catalogue of the directory it ran in, and a host serving several has
    // one catalogue.
    list: async () => (await Promise.all(dirs.map((served) => catalogue(served)))).flat(),

    // Whichever directory holds it. The transcript reader wants the one the
    // session ran in, and only its own catalogue knows which that was.
    transcript: async (id) => {
      for (const served of dirs) {
        const rows = await catalogue(served).catch(() => []);
        if (rows.some((row) => row.id === id))
          return turnsOf(id, served);
      }
      return undefined;
    },

    create: (start: Start) => createSession({
      uri: start.uri,
      chatUri: start.chatUri,
      cwd: workingDirectory(start.workingDirectory),
      settings: start.settings,
      schema: start.schema,
      emit: start.emit,
      ...(start.seedCustomizations ? { seedCustomizations: start.seedCustomizations } : {}),
      ...(start.resume !== undefined ? { resume: start.resume } : {}),
      ...(start.seed ? { seed: start.seed } : {}),
      ...(start.onFileEdit ? { onFileEdit: start.onFileEdit } : {}),
      ...(start.onHandshake ? { onHandshake: start.onHandshake } : {}),
    }),
  };
}
