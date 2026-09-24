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

import type { Bag } from '@ahpd/sdk';

/** As much of a pi model as anything here needs. */
export interface PiModel {
  provider: string;
  id: string;
  name?: string;
}

/** The key the thinking level rides under in a `ModelSelection.config`. */
export const THINKING_KEY = 'thinkingLevel';

/** One opaque wire id, spelled the way pi's own configuration spells a model. */
export const idOf = (model: PiModel): string => `${model.provider}/${model.id}`;

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

/**
 * One model, as a client is offered it.
 *
 * `configSchema` is present only when the model has more than one thinking
 * level to choose between: a form with one option is a control that cannot be
 * used, and a client that drew it would be asking a question with one answer.
 */
export function offered(model: PiModel, levels: readonly string[]): Bag {
  const row: Bag = {
    id: idOf(model),
    name: model.name ?? model.id,
    // Said plainly, because two providers serving a model of the same name is
    // the ordinary case and the row is all a person has to tell them apart.
    description: `${model.id} on ${model.provider}`,
  };
  if (levels.length > 1) {
    row.configSchema = {
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
    };
  }
  return row;
}
