import { isDeepStrictEqual } from 'node:util';
import type { SessionConfigOption, SessionModeState } from '@agentclientprotocol/sdk';
import type { Bag, Chosen, Session } from '@ahpd/sdk';
import type { AcpConnection } from '../types.js';
import { bag, messageOf } from './common.js';
import type { SessionContext } from './context.js';

/** The server's modes, its config options and its models, and what is drawn from them. */
export interface Config {
  learnModes(state: SessionModeState | null | undefined): void;
  learnConfigOptions(list: SessionConfigOption[] | null | undefined): void;
  learnModels(answer: unknown): void;
  configChanged(key: string, value: unknown): void;
  configOptionsChanged(list: SessionConfigOption[]): void;
  syncConfig(held: Record<string, unknown>): void;
  schemaOf(): Bag;
  changeModel(held: { connection: AcpConnection; sessionId: string }, chosen: Chosen | undefined): Promise<void>;
  sendAsked(held: { connection: AcpConnection; sessionId: string }, asked: Record<string, unknown>): Promise<void>;
  models: Session['models'];
  setConfig: NonNullable<Session['setConfig']>;
}

/** One value a picker draws: the id the server takes, its name, and what the server says of it. */
type Choice = { value: string; name: string; description: string | null | undefined };

export function createConfig(ctx: SessionContext): Config {
  const { emit, provider, values, start } = ctx;

  /**
   * The session config options the server named, once it has: ACP's
   * `configOptions`.
   *
   * This is where a model choice lives in ACP: the option whose category is
   * `model`, with the values the server serves. The bridge does not invent one,
   * so a session that has not opened answers no models.
   */
  let configOptions: SessionConfigOption[] = [];
  /**
   * The models a server from before config options named, where it named none.
   *
   * Those servers answered `session/new` with a `models` field rather than with
   * a model option. The SDK's types no longer carry it, so it is read off the
   * answer as it stands; it is only read when there is no option, because an
   * option is the newer account of the same thing.
   */
  let listedModels: { id: string; name: string }[] | undefined;

  /**
   * Remember the modes the server named, and where it currently sits.
   *
   * The ids the server offers are this session's `availableApprovalModes`,
   * as VS Code's Copilot agent reports the approval modes its session may
   * take, said with the rest of what the open learned.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotApprovalPolicy.ts#L159-L171
   */
  const learnModes = (state: SessionModeState | null | undefined): void => {
    if (state === null || state === undefined) return;
    ctx.modes = { ...state };
    values.permissionMode = state.currentModeId;
    values.availableApprovalModes = state.availableModes.map((one) => one.id);
  };

  /** The option a model choice is set through, when the server named one. */
  const modelOption = (): (SessionConfigOption & { type: 'select' }) | undefined =>
    configOptions.find((one): one is SessionConfigOption & { type: 'select' } => one.type === 'select' && one.category === 'model');

  /** The option a mode choice is set through, where the server names one. */
  const modeOption = (): (SessionConfigOption & { type: 'select' }) | undefined =>
    configOptions.find((one): one is SessionConfigOption & { type: 'select' } => one.type === 'select' && one.category === 'mode');

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
    configOptions.filter((one) => (one.type === 'select' || one.type === 'boolean')
      && keyOf(one) !== 'model' && keyOf(one) !== 'permissionMode');

  /**
   * Remember the session config options the server named, and where each stands.
   *
   * What moved is said by the caller: an open through `syncConfig` once it is
   * over, a value set and a turn's model through `configOptionsChanged`.
   */
  const learnConfigOptions = (list: SessionConfigOption[] | null | undefined): void => {
    if (list === null || list === undefined) return;
    configOptions = [...list];
    for (const option of configOptions) values[keyOf(option)] = option.currentValue;
    // A `mode` option's values are the modes the session may take.
    const mode = modeOption();
    if (mode !== undefined) values.availableApprovalModes = choicesOf(mode).map((one) => one.value);
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
    if (typeof current === 'string') values.model = current;
  };

  /**
   * One value the agent moved, said to every client and kept as the one in force.
   *
   * Said only when it is not the value already in force: a server may repeat an
   * update it has already made, and a client told the same thing twice has to
   * work out whether anything moved. The value is written as it is said, so
   * what a client hears and what `settings()` answers are one value. While
   * the session opens it is written alone, and said with the rest of what the
   * open learned once the open is over.
   */
  const configChanged = (key: string, value: unknown): void => {
    if (isDeepStrictEqual(values[key], value)) return;
    values[key] = value;
    if (!ctx.loading) emit('session', { type: 'session/configChanged', config: { [key]: value } });
  };

  /**
   * What an update's options say, said to every client.
   *
   * Said against the values in force before the update was learned, so an
   * option the server repeated is not said again: the whole list arrives on
   * every update, and on the answer to every value set, and only what moved is
   * news.
   */
  const configOptionsChanged = (list: SessionConfigOption[]): void => {
    for (const option of list) configChanged(keyOf(option), option.currentValue);
    const mode = list.find((one): one is SessionConfigOption & { type: 'select' } => one.type === 'select' && one.category === 'mode');
    if (mode !== undefined) configChanged('availableApprovalModes', choicesOf(mode).map((one) => one.value));
  };

  /**
   * The keys a client's value is on its way to the server for.
   *
   * The host said each one before handing it here, so the value a client holds
   * for it is settled by the set itself, whatever an open running beside it
   * learned. One entry per set, so two sets of one key are both waited out.
   */
  const setting: string[] = [];

  /**
   * What an open learned, said in one action where it differs from `held`.
   *
   * An open learns where the server sits, its mode, its options and its model,
   * and sends the values the session holds. Once it is over, each value that
   * differs from the config every client held as it began is said, as VS
   * Code's Copilot agent says the mode its runtime moved to, so a client draws
   * the values the server runs with, and a value the open put back where it
   * was is not news. A key a client is setting is the set's to settle.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L11447-L11478
   */
  const syncConfig = (held: Record<string, unknown>): void => {
    const moved = Object.fromEntries(Object.entries(values)
      .filter(([key, value]) => !isDeepStrictEqual(held[key], value) && !setting.includes(key)));
    if (Object.keys(moved).length > 0) emit('session', { type: 'session/configChanged', config: moved });
  };

  /**
   * A select's values, flattening any groups into the flat list a picker
   * draws, each with the description the server gave it.
   */
  const choicesOf = (option: SessionConfigOption & { type: 'select' }): Choice[] =>
    option.options
      .flatMap((entry) => ('group' in entry ? entry.options : [entry]))
      .map((one) => ({ value: one.value, name: one.name, description: one.description }));

  /**
   * Values as the picker a client draws: their ids as the enum, their names as
   * the labels and, where the server described any of them, one description
   * per value, empty for a value it gave none, which are the parallel arrays
   * the spec's schema carries for a picker.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/common/state.ts#L143-L170
   */
  const pickerOf = (choices: Choice[]): Bag => ({
    enum: choices.map((one) => one.value),
    enumLabels: choices.map((one) => one.name),
    ...(choices.some((one) => typeof one.description === 'string')
      ? { enumDescriptions: choices.map((one) => one.description ?? '') }
      : {}),
  });

  /**
   * One option, as the control a client draws.
   *
   * A select carries the values the server serves as its picker, which is the
   * only place they can come from, and the value in force as the default, so a
   * client that never asked still draws it where the agent left it.
   */
  const optionControl = (option: SessionConfigOption): Bag => ({
    type: option.type === 'boolean' ? 'boolean' : 'string',
    title: option.name,
    ...(option.description === null || option.description === undefined ? {} : { description: option.description }),
    sessionMutable: true,
    ...(option.type === 'select' ? pickerOf(choicesOf(option)) : {}),
    default: option.currentValue,
  });

  /**
   * The schema this session reports, with what the server named.
   *
   * The agent's own schema carries `permissionMode` without an `enum` unless the
   * preset named the agent's modes, because no server has been asked yet. A
   * session that has asked fills it in - from the `mode` option where the server
   * named one, and from the legacy modes where it did not, which is the only
   * place either can come from - and adds every other option as a control of
   * its own under `acp.<id>`.
   */
  const schemaOf = (): Bag => {
    const base = bag(start.schema());
    const properties = bag(base.properties);
    const mode = modeOption();
    const approvals = mode === undefined
      ? ctx.modes === undefined ? undefined : {
        ...pickerOf(ctx.modes.availableModes.map((one) => ({ value: one.id, name: one.name, description: one.description }))),
        default: ctx.modes.currentModeId,
      }
      : { ...pickerOf(choicesOf(mode)), default: mode.currentValue };
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
  const changeModel = async (
    held: { connection: AcpConnection; sessionId: string },
    chosen: Chosen | undefined,
  ): Promise<void> => {
    if (chosen === undefined) return;
    const option = modelOption();
    /*
     * A model the server does not offer is one the turn runs without: the
     * session keeps the model in force, and the choice is logged, as VS Code's
     * host keeps a chat's model when its agent does not offer the turn's.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2228-L2231
     */
    if (offeredFor('model')?.includes(chosen.id) !== true) {
      ctx.options.log?.(`${provider}: the session keeps its model: the server does not offer ${chosen.id}`);
      return;
    }
    /*
     * A server from before config options has no option to set, and takes the
     * model by the call it knew instead.
     */
    if (option === undefined) {
      if (values.model === chosen.id) return;
      await held.connection.setModel({ sessionId: held.sessionId, modelId: chosen.id });
      configChanged('model', chosen.id);
      return;
    }
    if (option.currentValue === chosen.id) return;
    const answer = await held.connection.setSessionConfigOption({
      sessionId: held.sessionId,
      configId: option.id,
      value: chosen.id,
    });
    configOptionsChanged(answer.configOptions);
    learnConfigOptions(answer.configOptions);
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
   * The kind of value a key takes, before any server has said more, or a
   * refusal naming the key.
   *
   * Two keys are this backend's: `permissionMode` is the server's mode, and
   * `model` is its model, set here even though it is not a schema property,
   * because a model belongs to the turn and a client may still send one. Every
   * other option the server offers is a control of its own under `acp.<id>`,
   * a choice or a switch, and a key naming none of these is refused by name,
   * because only this backend knows what the server serves.
   */
  const refusalOf = (key: string, value: unknown): string | undefined => {
    if (key === 'permissionMode' || key === 'model') {
      return typeof value === 'string' ? undefined : `${provider}: ${key} takes a string`;
    }
    if (key.startsWith('acp.')) {
      return typeof value === 'string' || typeof value === 'boolean' ? undefined : `${provider}: ${key} takes a string or true or false`;
    }
    return `${provider}: ${key} is not a config key this backend serves`;
  };

  /**
   * Put one config value to an open server, in the server's own terms.
   *
   * `permissionMode` goes through the `mode` option where the server names
   * one, the server's own account of it, and through the legacy modes where it
   * names none; `model` through the model option, or by the older call a
   * server from before config options takes; an `acp.<id>` value through the
   * option of that id, as the option's own kind.
   *
   * The value is put in force before the request goes out, so the server's own
   * update echoing it back is not news, and put back if the request fails. The
   * answer is said as an update's options are, so an option the server moved
   * with it reaches every client once.
   *
   * `true` when the server took it, and otherwise the reason in the backend's
   * words.
   */
  const applyConfig = async (
    held: { connection: AcpConnection; sessionId: string },
    key: string,
    value: unknown,
  ): Promise<true | string> => {
    const refused = refusalOf(key, value);
    if (refused !== undefined) return refused;
    const option = key === 'permissionMode' ? modeOption()
      : key === 'model' ? modelOption()
        : controlOptions().find((one) => `acp.${one.id}` === key);
    if (key.startsWith('acp.') && option === undefined) return `${provider}: this ACP server names no "${key.slice('acp.'.length)}" option`;
    if (option?.type === 'boolean' && typeof value !== 'boolean') return `${provider}: ${key} takes true or false`;
    if (option?.type === 'select' && typeof value !== 'string') return `${provider}: ${key} takes a string`;
    if (key === 'model' && option === undefined && !(listedModels ?? []).some((one) => one.id === value)) {
      return `${provider}: this ACP server names no model option, so model cannot be set`;
    }
    const before = values[key];
    values[key] = value;
    try {
      if (option !== undefined) {
        // Built for the option's own kind, which the guards above have said:
        // a switch goes as a boolean and a choice as one of its values.
        const answer = option.type === 'boolean'
          ? await held.connection.setSessionConfigOption({ sessionId: held.sessionId, configId: option.id, type: 'boolean', value: value === true })
          : await held.connection.setSessionConfigOption({ sessionId: held.sessionId, configId: option.id, value: String(value) });
        configOptionsChanged(answer.configOptions);
        learnConfigOptions(answer.configOptions);
      }
      else if (key === 'model') {
        await held.connection.setModel({ sessionId: held.sessionId, modelId: String(value) });
      }
      else {
        await held.connection.setSessionMode({ sessionId: held.sessionId, modeId: String(value) });
        if (ctx.modes !== undefined) ctx.modes = { ...ctx.modes, currentModeId: String(value) };
      }
      return true;
    }
    catch (why: unknown) {
      values[key] = before;
      return `${provider}: ${key} was not set: ${messageOf(why)}`;
    }
  };

  /**
   * Take a config value a client set, in the server's own terms.
   *
   * A session whose server is not open keeps the value, which the open sends
   * once the server has said what it offers, as VS Code's Claude agent keeps
   * a model chosen before its runtime launches: a value is no reason to start
   * a server. An open server is sent it at once, and one still opening once it
   * has opened, with the key left to this set by whatever the open says.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1160-L1177
   */
  const setConfig: NonNullable<Session['setConfig']> = async (key, value): Promise<true | string> => {
    if (ctx.opening === undefined) {
      const refused = refusalOf(key, value);
      if (refused !== undefined) return refused;
      values[key] = value;
      return true;
    }
    setting.push(key);
    try {
      return await applyConfig(await ctx.open(), key, value);
    }
    catch (why: unknown) {
      // An open that failed is this key failing too.
      return `${provider}: ${key} was not set: ${messageOf(why)}`;
    }
    finally {
      setting.splice(setting.indexOf(key), 1);
    }
  };

  /**
   * The values the server takes for a key, or nothing for a key that is not
   * the server's.
   *
   * Its modes for `permissionMode` and its models for `model`, from the option
   * it named for each or from the older lists where it named none; under
   * `acp.<id>` the values of the option of that id, a switch taking true or
   * false, and none at all for an id the server never named.
   */
  const offeredFor = (key: string): unknown[] | undefined => {
    if (key === 'permissionMode') {
      const option = modeOption();
      return option === undefined ? ctx.modes?.availableModes.map((one) => one.id) ?? [] : choicesOf(option).map((one) => one.value);
    }
    if (key === 'model') {
      const option = modelOption();
      return option === undefined ? (listedModels ?? []).map((one) => one.id) : choicesOf(option).map((one) => one.value);
    }
    if (!key.startsWith('acp.')) return undefined;
    const option = controlOptions().find((one) => `acp.${one.id}` === key);
    if (option === undefined) return [];
    return option.type === 'select' ? choicesOf(option).map((one) => one.value) : [true, false];
  };

  /**
   * Send the values the session holds, where the server offers them.
   *
   * `asked` is the config every client held as the open began: the values the
   * session was started with and every one a client set while no server was
   * open. The open reads it before it learns the server's own state, which
   * `learnModes`, `learnConfigOptions` and `learnModels` write over `values`.
   * Each value is sent where the server offers it and sits elsewhere, through the
   * call `setConfig` makes for its key, as VS Code's Claude agent starts its
   * runtime on the model the session chose before it launched.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1160-L1177
   *
   * A value the server does not offer, and one it refuses, leave the server's
   * own in force, which the open then says to every client: a session running
   * with another value is better than no session, so each is a line in the log
   * and the open goes on.
   */
  const sendAsked = async (
    held: { connection: AcpConnection; sessionId: string },
    asked: Record<string, unknown>,
  ): Promise<void> => {
    for (const [key, value] of Object.entries(asked)) {
      const offered = offeredFor(key);
      if (offered === undefined || value === values[key]) continue;
      const taken = offered.includes(value)
        ? await applyConfig(held, key, value)
        : `${provider}: the server does not offer ${key} ${JSON.stringify(value)}`;
      if (taken !== true) ctx.options.log?.(`${taken}, so the session runs with the server's own`);
    }
  };

  return {
    learnModes,
    learnConfigOptions,
    learnModels,
    configChanged,
    configOptionsChanged,
    syncConfig,
    schemaOf,
    changeModel,
    sendAsked,
    models,
    setConfig,
  };
}