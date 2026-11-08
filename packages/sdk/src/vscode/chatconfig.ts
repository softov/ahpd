/**
 * A chat's own config, as VS Code's protocol and host keep it ahead of the AHP
 * this host speaks: a property marked `chatMutable` may be set per chat with
 * `chat/configChanged`, the chat's state carries the values it set, and a
 * client's write is checked before it is taken.
 *
 * Vendored from VS Code's protocol copy (`ChatConfigState`,
 * `ChatConfigChangedAction` and the chat reducer's `chat/configChanged` case)
 * and from `sessionConfigProperties.ts` (`isChatConfigProperty`,
 * `filterChatConfigValues`, `validateChatConfigWrite`, and the part of
 * `getSessionConfigWriteError` that reads a property's own fields; its
 * approval-mode and workspace-property cases name keys this host does not
 * serve).
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/protocol/channels-chat/state.ts#L416-L445
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/protocol/channels-chat/actions.ts#L891-L910
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/protocol/channels-chat/reducer.ts#L958-L967
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L136-L150
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L167-L180
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/sessionConfigProperties.ts#L367-L381
 */

/** One property of a session's config schema, in the fields read here. */
export type ConfigProperty = {
  readonly enum?: readonly unknown[];
  readonly enumDynamic?: boolean;
  readonly readOnly?: boolean;
  readonly chatMutable?: boolean;
};

/** A session's config schema, in the fields read here. */
export type ConfigSchema = {
  readonly properties: Readonly<Record<string, ConfigProperty | undefined>>;
};

/**
 * A chat's configuration. `values` holds the chat's `chatMutable` properties
 * of the effective schema; `schema`, where present, is the chat's own.
 */
export interface ChatConfigState {
  schema?: unknown;
  values: Record<string, unknown>;
}

/** Config values set on a chat changed, merged into its values or replacing them. */
export interface ChatConfigChangedAction {
  type: 'chat/configChanged';
  config: Record<string, unknown>;
  replace?: boolean;
}

/** The chat reducer's case for `chat/configChanged`. */
export function reduceChatConfigChanged<S extends { config?: ChatConfigState }>(state: S, action: ChatConfigChangedAction): S {
  return {
    ...state,
    config: {
      ...state.config,
      values: action.replace || !state.config
        ? { ...action.config }
        : { ...state.config.values, ...action.config },
    },
  };
}

/** Whether a chat may set `key` for itself; every other property is set on the session. */
export function isChatConfigProperty(schema: ConfigSchema | undefined, key: string): boolean {
  return schema?.properties[key]?.chatMutable === true;
}

/** The values of `values` that the session's schema lets a chat set for itself. */
export function filterChatConfigValues(schema: ConfigSchema | undefined, values: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values ?? {}).filter(([key, value]) => value !== undefined && isChatConfigProperty(schema, key)));
}

/** `mutable`: whether the write may change the property at all. */
function getSessionConfigWriteError(schema: ConfigSchema, key: string, value: unknown, mutable: (property: ConfigProperty) => boolean): string | undefined {
  const property = schema.properties[key];
  if (!property || !mutable(property)) {
    return `Session configuration '${key}' is not writable.`;
  }
  if (value !== undefined && property.enum?.length && !property.enumDynamic && !property.enum.some((candidate) => candidate === value)) {
    return `Session configuration '${key}' does not offer '${String(value)}'.`;
  }
  return undefined;
}

/**
 * Throws when a client may not set `key` to `value` for a chat: the session's
 * write rules apply on top of the property being settable per chat.
 */
export function validateChatConfigWrite(schema: ConfigSchema, key: string, value: unknown): void {
  if (!isChatConfigProperty(schema, key)) {
    throw new Error(`Session configuration '${key}' cannot be set for a chat.`);
  }
  // A chat may set a `chatMutable` property for itself even when the session's value is fixed; read-only ones are host-written.
  const error = getSessionConfigWriteError(schema, key, value, (property) => property.readOnly !== true);
  if (error) {
    throw new Error(error);
  }
}
