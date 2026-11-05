import type { Adapter, Capability, Connector, Icon } from '@ahpd/sdk';
import type { ActionDescription, AuthDescription, PieceDescription, PropDescription } from './wire.js';

/**
 * What a piece becomes.
 *
 * A piece is one adapter, `ap-<name>`, and each of its actions is an `action`
 * capability, with the action's props as the input a client draws. The piece's
 * auth is the connector's schema, so a connector of the adapter is one account:
 * each secret field is `secret`, and the host keeps its value in the vault.
 *
 * The mapping reads only the description the engine sent, so it holds no piece
 * and no function of one. What a piece does with its auth and its input is the
 * engine's to do when a call arrives.
 */

/** What every adapter of this plugin is called before the piece's name. */
export const PREFIX = 'ap-';

/** The auth types a connector of this plugin can carry. */
const OFFERED = ['SECRET_TEXT', 'CUSTOM_AUTH'];

/** The name of one action's description, as the capability carries it. */
const descriptionOf = (action: ActionDescription): string => {
  const written = action.aiDescription !== undefined && action.aiDescription !== ''
    ? action.aiDescription
    : action.description;
  return written !== '' ? written : action.displayName;
};

/**
 * The adapter name of one piece, or nothing when the specifier names none.
 *
 * A piece is a package, `@activepieces/piece-<name>`. A test names a piece by
 * the URL of its file, and such a file is named `piece-<name>.mjs`, so the
 * adapter carries the same name whichever way the piece was named.
 */
export function nameOf(spec: string): string | undefined {
  const packaged = /^@activepieces\/piece-([a-z0-9][a-z0-9-]*)$/.exec(spec)?.[1];
  if (packaged !== undefined) return `${PREFIX}${packaged}`;
  const filed = /\/piece-([a-z0-9][a-z0-9-]*)\.(?:mjs|cjs|js|ts)$/.exec(spec)?.[1];
  return filed === undefined ? undefined : `${PREFIX}${filed}`;
}

/** The auth entry a connector fills in: the first of a list that this plugin offers. */
export function entryOf(auth: AuthDescription | AuthDescription[] | undefined): AuthDescription | undefined {
  if (auth === undefined) return undefined;
  const entries = Array.isArray(auth) ? auth : [auth];
  return entries.find((one) => OFFERED.includes(one.type));
}

/**
 * The JSON Schema of one prop, or nothing when the prop is not a value.
 *
 * A `MARKDOWN` prop is text a builder UI shows, so it is not in the input. A
 * `FILE` prop is a string: an `https:` URL, a `data:` URI, or the name of a
 * session attachment, which the engine turns into the file a piece reads.
 *
 * An `ARRAY` prop that names the props of one item is an array of objects,
 * those fields on each; one that names none is an array of strings, which is
 * how the pieces themselves read it. An `OBJECT` or `DYNAMIC` prop is an object
 * whose values are unnamed, and a `JSON` prop is any value at all: the one
 * schema that says so is `{}`.
 */
export function propOf(prop: PropDescription): Record<string, unknown> | undefined {
  if (prop.type === 'MARKDOWN') return undefined;
  if (prop.type === 'JSON') return {};
  const schema: Record<string, unknown> = { title: prop.displayName };
  const described = prop.description !== undefined && prop.description !== '';
  switch (prop.type) {
    case 'FILE':
      schema['type'] = 'string';
      schema['description'] = described
        ? `${prop.description ?? ''} An https: URL, a data: URI or the name of a session attachment.`
        : 'An https: URL, a data: URI or the name of a session attachment.';
      break;
    case 'NUMBER':
      schema['type'] = 'number';
      break;
    case 'CHECKBOX':
      schema['type'] = 'boolean';
      break;
    case 'ARRAY': {
      const item = prop.props === undefined ? undefined : inputOf(prop.props);
      schema['type'] = 'array';
      schema['items'] = item ?? { type: 'string' };
      break;
    }
    case 'OBJECT':
    case 'DYNAMIC':
      schema['type'] = 'object';
      schema['additionalProperties'] = {};
      break;
    case 'DATE_TIME':
      schema['type'] = 'string';
      schema['format'] = 'date-time';
      break;
    case 'STATIC_DROPDOWN':
      schema['type'] = 'string';
      if (prop.options !== undefined) schema['enum'] = prop.options;
      break;
    case 'DROPDOWN':
      // A dropdown's options are a call the engine cannot make while it describes.
      schema['type'] = 'string';
      schema['description'] = described ? `${prop.description ?? ''} Give the id.` : 'Give the id.';
      break;
    default:
      schema['type'] = 'string';
  }
  if (described && prop.type !== 'DROPDOWN' && prop.type !== 'FILE') schema['description'] = prop.description;
  return schema;
}

/**
 * The input schema of one action, each prop by the name the piece reads it by,
 * or nothing when the action names no prop a client can draw.
 *
 * An action with no props takes nothing, and a capability with no `input` is
 * the one way to say so: `{ type: 'object' }` with no properties is a form a
 * client draws as "No parameters defined." and a hole this host reports.
 */
export function inputOf(props: Record<string, PropDescription>): Record<string, unknown> | undefined {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, prop] of Object.entries(props)) {
    const schema = propOf(prop);
    if (schema === undefined) continue;
    properties[name] = schema;
    if (prop.required) required.push(name);
  }
  if (Object.keys(properties).length === 0) return undefined;
  const input: Record<string, unknown> = { type: 'object', properties };
  if (required.length > 0) input['required'] = required;
  return input;
}

/**
 * The schema a connector of one piece fills in, or nothing for an auth that
 * this plugin does not offer.
 *
 * A `SECRET_TEXT` auth is the one string the piece reads as `auth.secret_text`.
 * A `CUSTOM_AUTH` auth is its own props, each secret among them `secret`, so
 * the host keeps each value in the vault.
 */
export function schemaOf(auth: AuthDescription): Record<string, unknown> | undefined {
  if (auth.type === 'SECRET_TEXT') {
    const field: Record<string, unknown> = { type: 'string', secret: true, title: auth.displayName };
    if (auth.description !== undefined && auth.description !== '') field['description'] = auth.description;
    return { type: 'object', properties: { secret_text: field }, required: ['secret_text'] };
  }
  if (auth.type !== 'CUSTOM_AUTH') return undefined;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [name, prop] of Object.entries(auth.props ?? {})) {
    const schema = propOf(prop);
    if (schema === undefined) continue;
    if (prop.type === 'SECRET_TEXT') {
      schema['type'] = 'string';
      schema['secret'] = true;
    }
    properties[name] = schema;
    if (prop.required) required.push(name);
  }
  const schema: Record<string, unknown> = { type: 'object', properties };
  if (required.length > 0) schema['required'] = required;
  if (auth.description !== undefined) schema['description'] = auth.description;
  return schema;
}

/**
 * The auth value a piece reads, built from the connector's config.
 *
 * The host reads each `secret` field back from the vault before it hands
 * the connector over, so the config holds the values themselves. A secret-text
 * piece reads `auth.secret_text`, and a custom-auth piece reads each field
 * under `auth.props`, by the name the piece declared.
 */
export function authOf(auth: AuthDescription, connector: Connector): Record<string, unknown> {
  const config = connector.config;
  if (auth.type === 'SECRET_TEXT') return { type: 'SECRET_TEXT', secret_text: config['secret_text'] };
  const props: Record<string, unknown> = {};
  for (const name of Object.keys(auth.props ?? {})) {
    const value = config[name];
    if (value !== undefined) props[name] = value;
  }
  return { type: 'CUSTOM_AUTH', props };
}

/** One call of an action, as the plugin's engine runs it. */
export interface RunCallArgs {
  /** The connector the call is for, which is also its store's key. */
  connector: string;
  /** The name of the action. */
  action: string;
  /** The auth value the piece reads. */
  auth: Record<string, unknown>;
  /** The input of the call. */
  input: Record<string, unknown>;
  /** The calling session's attachments folder, when it has one. */
  files?: string;
}

/** The one who runs a call, which the plugin answers with its engine. */
export type RunCall = (call: RunCallArgs) => Promise<unknown>;

/** What one piece becomes: its adapter, and one line for each part left out. */
export interface Mapping {
  /** The adapter the piece makes, or nothing when its auth is not one this plugin offers. */
  adapter?: Adapter;
  /** One line for each action, or each piece, the plugin does not offer. */
  notes: string[];
}

/** The adapter one piece makes, and what was left out of it. */
export function adapterOf(piece: PieceDescription, run?: RunCall, icon?: Icon): Mapping {
  const name = nameOf(piece.package);
  if (name === undefined) {
    return { notes: [`${piece.package} is not a piece package, so it has no adapter`] };
  }
  const entry = entryOf(piece.auth);
  const schema = entry === undefined ? undefined : schemaOf(entry);
  if (entry === undefined || schema === undefined) {
    return { notes: [`${name}: the piece's auth is neither a secret text nor a custom auth, so it has no adapter`] };
  }

  const notes: string[] = [];
  const capabilities: Capability[] = [];
  for (const action of piece.actions) {
    const input = inputOf(action.props);
    capabilities.push({
      type: 'action',
      name: action.name,
      title: action.displayName,
      description: descriptionOf(action),
      // An action that names no prop takes nothing, and a capability with no
      // input is how a client is told that.
      ...(input === undefined ? {} : { input }),
    });
  }

  const adapter: Adapter = {
    name,
    title: piece.displayName,
    description: piece.description ?? `One account of ${piece.displayName}, with its key.`,
    schema,
    capabilities,
    // The piece's logo, when it published one the host could read.
    ...(icon === undefined ? {} : { icons: [icon] }),
    // A connector holds no state here: each call brings its own auth.
    open: () => undefined,
  };
  if (run !== undefined) {
    adapter.run = (connector, action, input, call) => run({
      connector: connector.id,
      action,
      auth: authOf(entry, connector),
      input,
      ...(call?.files === undefined ? {} : { files: call.files }),
    });
  }
  return { adapter, notes };
}
