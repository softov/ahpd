import type { SessionConfigOption, SessionModeState } from '@agentclientprotocol/sdk';
import type { Bag, Chosen, Session } from '@ahpd/sdk';
import type { AcpConnection } from '../types.js';
import { bag, messageOf } from './common.js';
import type { SessionContext } from './context.js';

/** The server's modes, its config options and its models, and what is drawn from them. */
export interface Config {
  learnModes(state: SessionModeState | null | undefined): void;
  learnOffers(list: SessionConfigOption[] | null | undefined): void;
  learnModels(answer: unknown): void;
  configChanged(key: string, value: unknown): void;
  offersChanged(list: SessionConfigOption[]): void;
  schemaOf(): Bag;
  chooseModel(held: { connection: AcpConnection; sessionId: string }, chosen: Chosen | undefined): Promise<void>;
  models: Session['models'];
  setConfig: NonNullable<Session['setConfig']>;
}

export function createConfig(ctx: SessionContext): Config {
  const { emit, provider, settings, start } = ctx;

  /**
   * The session config options the server named, once it has.
   *
   * This is where a model choice lives in ACP: the option whose category is
   * `model`, with the values the server serves. The bridge does not invent one,
   * so a session that has not opened answers no models.
   */
  let offers: SessionConfigOption[] = [];
  /**
   * The models a server from before config options named, where it named none.
   *
   * Those servers answered `session/new` with a `models` field rather than with
   * a model option. The SDK's types no longer carry it, so it is read off the
   * answer as it stands; it is only read when there is no option, because an
   * option is the newer account of the same thing.
   */
  let listedModels: { id: string; name: string }[] | undefined;

  /** Remember the modes the server named, and where it currently sits. */
  const learnModes = (state: SessionModeState | null | undefined): void => {
    if (state === null || state === undefined) return;
    ctx.modes = { ...state };
    settings.permissionMode = state.currentModeId;
  };

  /** The option a model choice is set through, when the server named one. */
  const modelOption = (): (SessionConfigOption & { type: 'select' }) | undefined =>
    offers.find((one): one is SessionConfigOption & { type: 'select' } => one.type === 'select' && one.category === 'model');

  /** The option a mode choice is set through, where the server names one. */
  const modeOption = (): (SessionConfigOption & { type: 'select' }) | undefined =>
    offers.find((one): one is SessionConfigOption & { type: 'select' } => one.type === 'select' && one.category === 'mode');

  /**
   * The key an option's value is kept under.
   *
   * A `mode` option is the newer account of the same thing the legacy modes
   * carry, so it is where `permissionMode` is read from, and a `model` option
   * is the model. Every other option is a control of its own, under the
   * server's own id: the ids belong to the server and the other keys belong to
   * the host, so the two are kept apart by a prefix.
   */
  const keyOf = (option: SessionConfigOption): string => {
    if (option.type === 'select' && option.category === 'model') return 'model';
    if (option.type === 'select' && option.category === 'mode') return 'permissionMode';
    return `acp.${option.id}`;
  };

  /**
   * The options that are controls of their own, rather than the model or the mode.
   *
   * Only the two kinds a control can draw: what the protocol carries is a
   * choice of values or a switch, and a server naming anything else has named
   * something this bridge cannot put in front of a person.
   */
  const controlOptions = (): SessionConfigOption[] =>
    offers.filter((one) => (one.type === 'select' || one.type === 'boolean')
      && keyOf(one) !== 'model' && keyOf(one) !== 'permissionMode');

  /**
   * Remember the session config options the server named, and where each stands.
   *
   * A value learned this way is written down and not said out: the client that
   * asked for the session reads it out of `config.values` rather than being
   * told what it asked about.
   */
  const learnOffers = (list: SessionConfigOption[] | null | undefined): void => {
    if (list === null || list === undefined) return;
    offers = [...list];
    for (const option of offers) settings[keyOf(option)] = option.currentValue;
  };

  /**
   * The models a server from before config options named, kept.
   *
   * Those servers answered `session/new` with a `models` field of their own
   * rather than with a model option, and the SDK's types no longer carry it, so
   * it is read off the answer as it stands. An option wins: where a server
   * names both, the option is the newer account of the same thing, and reading
   * the older one as well would give a client two answers to one question.
   */
  const learnModels = (answer: unknown): void => {
    if (modelOption() !== undefined) return;
    const named = bag(answer).models;
    const held = bag(named).availableModels;
    if (!Array.isArray(held)) return;
    listedModels = held
      .filter((one): one is { modelId: string; name: string } => typeof bag(one).modelId === 'string')
      .map((one) => ({ id: one.modelId, name: typeof one.name === 'string' ? one.name : one.modelId }));
    const current = bag(named).currentModelId;
    if (typeof current === 'string') settings.model = current;
  };

  /**
   * One value the agent moved, said to every client and kept as the one in force.
   *
   * Said only when it is not the value already in force: a server may repeat an
   * update it has already made, and a client told the same thing twice has to
   * work out whether anything moved. This is the only place `session/configChanged`
   * goes out, so that what a client hears and what `settings()` answers cannot drift.
   */
  const configChanged = (key: string, value: unknown): void => {
    if (settings[key] === value) return;
    settings[key] = value;
    emit('session', { type: 'session/configChanged', config: { [key]: value } });
  };

  /**
   * What an update's options say, said to every client.
   *
   * Said against the values in force before the update was learned, so an
   * option the server repeated is not said again - the whole list arrives on
   * every update, and only what moved is news.
   */
  const offersChanged = (list: SessionConfigOption[]): void => {
    for (const option of list) configChanged(keyOf(option), option.currentValue);
  };

  /** A select's values, flattening any groups into the flat list a picker draws. */
  const choicesOf = (option: SessionConfigOption & { type: 'select' }): { value: string; name: string }[] => {
    const choices: { value: string; name: string }[] = [];
    for (const entry of option.options) {
      if ('group' in entry) {
        for (const leaf of entry.options) choices.push({ value: leaf.value, name: leaf.name });
      }
      else choices.push({ value: entry.value, name: entry.name });
    }
    return choices;
  };

  /**
   * One option, as the control a client draws.
   *
   * A select carries the values the server serves as its enum and their names
   * as the labels, which is the only place either can come from, and the value
   * in force as the default, so a client that never asked still draws it where
   * the agent left it.
   */
  const optionControl = (option: SessionConfigOption): Bag => {
    const choices = option.type === 'select' ? choicesOf(option) : [];
    return {
      scope: 'session',
      type: option.type === 'boolean' ? 'boolean' : 'string',
      title: option.name,
      ...(option.description === null || option.description === undefined ? {} : { description: option.description }),
      sessionMutable: true,
      ...(option.type === 'boolean'
        ? { default: option.currentValue }
        : {
            enum: choices.map((one) => one.value),
            enumLabels: choices.map((one) => one.name),
            default: option.currentValue,
          }),
    };
  };

  /**
   * The schema this session reports, with what the server named.
   *
   * The agent's own schema carries `permissionMode` without an `enum`, because
   * no server has been asked yet. A session that has asked fills it in - from
   * the `mode` option where the server named one, and from the legacy modes
   * where it did not, which is the only place either can come from - and adds
   * every other option as a control of its own under `acp.<id>`.
   */
  const schemaOf = (): Bag => {
    const base = bag(start.schema());
    const properties = bag(base.properties);
    const mode = modeOption();
    const approvals = mode === undefined
      ? ctx.modes === undefined ? undefined : {
        enum: ctx.modes.availableModes.map((one) => one.id),
        enumLabels: ctx.modes.availableModes.map((one) => one.name),
        default: ctx.modes.currentModeId,
      }
      : {
        enum: choicesOf(mode).map((one) => one.value),
        enumLabels: choicesOf(mode).map((one) => one.name),
        default: mode.currentValue,
      };
    const controls = controlOptions().map((one) => [keyOf(one), optionControl(one)] as const);
    if (approvals === undefined && controls.length === 0) return base;
    return {
      ...base,
      properties: {
        ...properties,
        ...(approvals === undefined ? {} : { permissionMode: { ...bag(properties.permissionMode), ...approvals } }),
        ...Object.fromEntries(controls),
      },
    };
  };

  /**
   * Point the server at the model the turn asked for, before the prompt.
   *
   * ACP carries the model as a session config option, so the choice is one
   * `session/set_config_option` when the server's current value differs. A
   * failure here fails the turn rather than prompting with the wrong model: an
   * answer from a model nobody selected is worse than an error saying so.
   */
  const chooseModel = async (
    held: { connection: AcpConnection; sessionId: string },
    chosen: Chosen | undefined,
  ): Promise<void> => {
    if (chosen === undefined) return;
    const option = modelOption();
    /*
     * A server from before config options has no option to set, and takes the
     * model by the call it knew instead. The list it named is the only place
     * a choice can be checked against, so an id it did not offer is the same
     * failure as a server that offered none.
     */
    if (option === undefined) {
      const listed = listedModels ?? [];
      const served = listed.find((one) => one.id === chosen.id);
      if (served === undefined) {
        throw new Error(`${provider}: this ACP server names no model option, so "${chosen.id}" cannot be chosen`);
      }
      if (settings.model === served.id) return;
      await held.connection.setModel({ sessionId: held.sessionId, modelId: served.id });
      settings.model = served.id;
      return;
    }
    if (option.currentValue === chosen.id) return;
    const answer = await held.connection.setSessionConfigOption({
      sessionId: held.sessionId,
      configId: option.id,
      value: chosen.id,
    });
    learnOffers(answer.configOptions);
  };

  /**
   * The models this session can run a turn on.
   *
   * Read from the server's own model option, or from the list a server from
   * before options named instead, because only the server knows what it
   * serves. Before the session has opened there is no honest answer but an
   * empty list: the agent's `probe` cannot know either, ACP advertising
   * models on `session/new` rather than on `initialize`.
   */
  const models: Session['models'] = () => {
    const option = modelOption();
    if (option !== undefined) return choicesOf(option).map((choice) => ({ id: choice.value, name: choice.name }));
    return listedModels ?? [];
  };

  /**
   * Take a config value, in the server's own terms.
   *
   * Two keys are this backend's: `permissionMode` is the server's mode, and
   * `model` is its model option. `model` is set here even though it is not a
   * schema property, because a model belongs to the turn rather than to the
   * conversation and a client may still send one. Every other option the
   * server offered is a control of its own under `acp.<id>`, and a key
   * naming no option at all is refused by name, because only this backend
   * knows what the server serves.
   */
  const setConfig: NonNullable<Session['setConfig']> = async (key, value): Promise<true | string> => {
    /*
     * The value asked for, held before the request goes out, so the server's
     * own update echoing it back is not announced as a change; put back if the
     * request fails.
     */
    let sent: { key: string; before: unknown } | undefined;
    const unsent = (): void => {
      if (sent !== undefined) settings[sent.key] = sent.before;
    };
    if (key === 'permissionMode') {
      if (typeof value !== 'string') return `${provider}: permissionMode takes a string`;
      try {
        const held = await ctx.open();
        // The `mode` option is the server's own account of this, so it is
        // asked through the same call as any other option; the legacy modes
        // are what is left when it names none.
        const option = modeOption();
        sent = { key, before: settings[key] };
        settings[key] = value;
        if (option === undefined) {
          await held.connection.setSessionMode({ sessionId: held.sessionId, modeId: value });
          if (ctx.modes !== undefined) ctx.modes = { ...ctx.modes, currentModeId: value };
        }
        else {
          learnOffers((await held.connection.setSessionConfigOption({
            sessionId: held.sessionId,
            configId: option.id,
            value,
          })).configOptions);
        }
        ctx.touch();
        return true;
      }
      catch (why: unknown) {
        unsent();
        return `${provider}: permissionMode was not set: ${messageOf(why)}`;
      }
    }
    if (key === 'model') {
      if (typeof value !== 'string') return `${provider}: model takes a string`;
      try {
        // Opened before the option is looked for: the server names its model
        // option on `session/new`, so a session that has not opened has not
        // been told what a model may be set to.
        const held = await ctx.open();
        const option = modelOption();
        if (option === undefined) {
          // A server from before config options takes it by the older call,
          // as a turn naming one does.
          if (!(listedModels ?? []).some((one) => one.id === value)) {
            return `${provider}: this ACP server names no model option, so model cannot be set`;
          }
          sent = { key, before: settings[key] };
          settings[key] = value;
          await held.connection.setModel({ sessionId: held.sessionId, modelId: value });
          ctx.touch();
          return true;
        }
        sent = { key, before: settings[key] };
        settings[key] = value;
        const answer = await held.connection.setSessionConfigOption({
          sessionId: held.sessionId,
          configId: option.id,
          value,
        });
        learnOffers(answer.configOptions);
        ctx.touch();
        return true;
      }
      catch (why: unknown) {
        unsent();
        return `${provider}: model was not set: ${messageOf(why)}`;
      }
    }
    if (key.startsWith('acp.')) {
      const id = key.slice('acp.'.length);
      try {
        // Opened before the option is looked for, as with the model: the
        // server names its options on `session/new`, so a session that has
        // not opened has not been told what may be set. Inside the guard,
        // because an open that failed is this key failing too.
        const held = await ctx.open();
        const option = controlOptions().find((one) => one.id === id);
        if (option === undefined) return `${provider}: this ACP server names no "${id}" option`;
        if (option.type === 'boolean' && typeof value !== 'boolean') return `${provider}: ${key} takes true or false`;
        if (option.type === 'select' && typeof value !== 'string') return `${provider}: ${key} takes a string`;
        if (typeof value !== 'string' && typeof value !== 'boolean') return `${provider}: ${key} takes a string or true or false`;
        // Built for the option's own kind, which the guards above have said:
        // a boolean goes as a boolean and a select as one of its values.
        sent = { key, before: settings[key] };
        settings[key] = value;
        const answer = option.type === 'boolean'
          ? await held.connection.setSessionConfigOption({ sessionId: held.sessionId, configId: option.id, type: 'boolean', value: value === true })
          : await held.connection.setSessionConfigOption({ sessionId: held.sessionId, configId: option.id, value: String(value) });
        learnOffers(answer.configOptions);
        ctx.touch();
        return true;
      }
      catch (why: unknown) {
        unsent();
        return `${provider}: ${key} was not set: ${messageOf(why)}`;
      }
    }
    return `${provider}: ${key} is not a config key this backend serves`;
  };

  return {
    learnModes,
    learnOffers,
    learnModels,
    configChanged,
    offersChanged,
    schemaOf,
    chooseModel,
    models,
    setConfig,
  };
}