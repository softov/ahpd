/**
 * pi's model catalogue, as the protocol's model description.
 *
 * The protocol asks a host for a list of models with one opaque id each, and
 * pi identifies a model by a provider *and* an id - two models called
 * `gpt-4o-mini` from two providers are two different things to run a turn on.
 * So the wire id is `provider/modelId`, which is also how pi's own
 * configuration spells one, and nothing has to be invented to tell them apart.
 *
 * pi's thinking level is not a second model. It is a setting on the one that
 * was chosen, so it travels as a `configSchema` - the protocol's own escape
 * hatch for a model that needs an answer beside its name. A client renders the
 * schema as a form and sends the values back in `ModelSelection.config`, which
 * is exactly where `begin` reads it from.
 */

import type { Offered } from '@ahpd/sdk';

/** As much of a pi model as anything here needs. */
export interface PiModel {
  provider: string;
  id: string;
  name?: string;
  /** How many tokens the model can hold, when pi knows. */
  contextWindow?: number;
  /** How many tokens the model may answer with, when pi knows. */
  maxTokens?: number;
  /**
   * What the model takes beyond text, as pi lists it.
   *
   * A model that does not list `image` is sent a picture's path rather than
   * its bytes, because a provider that refuses one fails the whole turn.
   */
  input?: ('text' | 'image')[];
}

/** The key the thinking level rides under in a `ModelSelection.config`. */
export const THINKING_KEY = 'thinkingLevel';

/** One opaque wire id, spelled the way pi's own configuration spells a model. */
export const idOf = (model: PiModel): string => `${model.provider}/${model.id}`;

/**
 * One model as a session's `models()` and the agent's `probe` list it, in the
 * spec's model info fields read from pi's own: the limits pi knows, whether it
 * takes an image, and the thinking levels pi's rule gives it as the model's
 * `configSchema`, as VS Code's agents list each model; the host adds the
 * provider.
 *
 * The one shape both answer with, so the list the host holds from boot and the
 * one a session reports later name every model the same way. `configSchema` is
 * present only when the model has more than one thinking level to choose
 * between: a form with one option is a control that cannot be used.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L120-L144
 */
export function listed(model: PiModel, levels: readonly string[]): Offered['models'][number] {
  return {
    id: idOf(model),
    name: model.name ?? model.id,
    // A model pi knows nothing about gets no number rather than a made-up one.
    ...(typeof model.contextWindow === 'number' && model.contextWindow > 0 ? { maxContextWindow: model.contextWindow } : {}),
    ...(typeof model.maxTokens === 'number' && model.maxTokens > 0 ? { maxOutputTokens: model.maxTokens } : {}),
    ...(model.input === undefined ? {} : { supportsVision: model.input.includes('image') }),
    ...(levels.length > 1 ? {
      configSchema: {
        type: 'object',
        properties: {
          [THINKING_KEY]: {
            type: 'string',
            title: 'Thinking',
            description: 'How much the model reasons before it answers.',
            enum: [...levels],
            default: levels[0],
          },
        },
      },
    } : {}),
  };
}

/**
 * The model a wire id names.
 *
 * A qualified id is looked up as itself. A bare one - a draft written before
 * this host qualified them, or a client repeating what an older list said - is
 * accepted only when exactly one model answers to it, or when it is already
 * the model this session is on. Guessing a provider for an ambiguous name
 * would run the turn somewhere nobody asked for, on somebody's paid account.
 */
export function modelFor<T extends PiModel>(
  models: readonly T[],
  wanted: string,
  current?: PiModel,
): T | undefined {
  const exact = models.find((model) => idOf(model) === wanted);
  if (exact !== undefined) return exact;
  const bare = models.filter((model) => model.id === wanted);
  if (bare.length === 1) return bare[0];
  if (current?.id === wanted) return bare.find((model) => model.provider === current.provider);
  return undefined;
}

