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

/** The auth kinds a connector of this plugin can carry, as Activepieces' connection types name them. */
const OFFERED = ['SECRET_TEXT', 'BASIC_AUTH', 'CUSTOM_AUTH'];

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

/**
 * The auth entries a connector may be one of: each kind of a piece's list
 * this plugin carries, in the piece's order, as Activepieces lets a person pick
 * any kind the piece lists.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/docs/build-pieces/piece-reference/authentication.mdx
 */
export function entriesOf(auth: AuthDescription | AuthDescription[] | undefined): AuthDescription[] {
  if (auth === undefined) return [];
  return (Array.isArray(auth) ? auth : [auth]).filter((one) => OFFERED.includes(one.type));
}

/**
 * The JSON Schema of one prop, or nothing when the prop is not a value.
 *
 * A `MARKDOWN` prop is text a builder UI shows, so it is not in the input. A
 * `FILE` prop is a string: a URL, a base64 `data:` URI, or the name of a
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
        ? `${prop.description ?? ''} A URL, a base64 data: URI or the name of a session attachment.`
        : 'A URL, a base64 data: URI or the name of a session attachment.';
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
    case 'STATIC_MULTI_SELECT_DROPDOWN':
      // Several of the options, as Activepieces collects a multi-select's values.
      schema['type'] = 'array';
      schema['items'] = prop.options === undefined ? { type: 'string' } : { enum: prop.options };
      break;
    case 'MULTI_SELECT_DROPDOWN':
      schema['type'] = 'array';
      schema['items'] = { type: 'string' };
      schema['description'] = described ? `${prop.description ?? ''} Give the ids.` : 'Give the ids.';
      break;
    case 'DROPDOWN':
      // A dropdown's options are a call the engine cannot make while it describes.
      schema['type'] = 'string';
      schema['description'] = described ? `${prop.description ?? ''} Give the id.` : 'Give the id.';
      break;
    default:
      schema['type'] = 'string';
  }
  if (described && prop.type !== 'DROPDOWN' && prop.type !== 'MULTI_SELECT_DROPDOWN' && prop.type !== 'FILE') schema['description'] = prop.description;
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
 * The fields of one auth kind's form, each secret among them `secret` so the
 * host keeps its value in the vault, and the fields the kind requires.
 *
 * A `SECRET_TEXT` auth is the one string the piece reads as `auth.secret_text`.
 * A `BASIC_AUTH` auth is a username and a password, the separate fields
 * Activepieces collects for it, the password secret. A `CUSTOM_AUTH` auth is
 * its own props.
 */
const formOf = (auth: AuthDescription): { properties: Record<string, unknown>; required: string[] } => {
  const described = (field: Record<string, unknown>, description: string | undefined): Record<string, unknown> =>
    (description === undefined || description === '' ? field : { ...field, description });
  if (auth.type === 'SECRET_TEXT') {
    return { properties: { secret_text: described({ type: 'string', secret: true, title: auth.displayName }, auth.description) }, required: ['secret_text'] };
  }
  if (auth.type === 'BASIC_AUTH') {
    return {
      properties: {
        username: described({ type: 'string', title: auth.username?.displayName ?? 'Username' }, auth.username?.description),
        password: described({ type: 'string', secret: true, title: auth.password?.displayName ?? 'Password' }, auth.password?.description),
      },
      required: ['username', 'password'],
    };
  }
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
  return { properties, required };
};

/** The field that names which kind a connector of a piece with several is, as Activepieces' connection value names it. */
const KIND = 'type';

/**
 * The schema a connector of one piece fills in, or nothing for a piece whose
 * auth this plugin does not carry.
 *
 * One kind is that kind's form. Several are a `type` the person picks, as
 * Activepieces has a person pick the kind of a connection, beside every
 * kind's fields, and each kind's own fields are required once it is picked.
 * The fields stay at the top of the schema, which is where the host reads the
 * secret ones from.
 */
export function schemaOf(entries: AuthDescription[]): Record<string, unknown> | undefined {
  const [only] = entries;
  if (only === undefined) return undefined;
  if (entries.length === 1) {
    const form = formOf(only);
    return {
      type: 'object',
      properties: form.properties,
      ...(form.required.length === 0 ? {} : { required: form.required }),
      // A secret text's description is its one field's, and a form of several
      // fields carries its own.
      ...(only.type === 'SECRET_TEXT' || only.description === undefined ? {} : { description: only.description }),
    };
  }
  const forms = entries.map((entry) => ({ entry, form: formOf(entry) }));
  return {
    type: 'object',
    properties: {
      [KIND]: { type: 'string', title: 'Connection', enum: entries.map((entry) => entry.type), enumLabels: entries.map((entry) => entry.displayName) },
      ...Object.assign({}, ...forms.map(({ form }) => form.properties)) as Record<string, unknown>,
    },
    required: [KIND],
    allOf: forms.map(({ entry, form }) => ({
      if: { properties: { [KIND]: { const: entry.type } } },
      then: { required: form.required },
    })),
  };
}

/**
 * The auth value a piece reads, built from the connector's config, in the
 * shape of Activepieces' connection value of its kind.
 *
 * The host reads each `secret` field back from the vault before it hands the
 * connector over, so the config holds the values themselves. A secret-text
 * piece reads `auth.secret_text`, a basic-auth piece `auth.username` and
 * `auth.password`, and a custom-auth piece each field under `auth.props`, by
 * the name the piece declared. The kind is the one the connector picked, or
 * the piece's one.
 */
export function authOf(entries: AuthDescription[], connector: Connector): Record<string, unknown> {
  const config = connector.config;
  const auth = entries.length === 1 ? entries[0] : entries.find((entry) => entry.type === config[KIND]);
  if (auth === undefined) return { type: config[KIND] };
  if (auth.type === 'SECRET_TEXT') return { type: 'SECRET_TEXT', secret_text: config['secret_text'] };
  if (auth.type === 'BASIC_AUTH') return { type: 'BASIC_AUTH', username: config['username'], password: config['password'] };
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

/** The piece's own check of a connection's auth value: whether it took it, and what it said when not. */
export type ValidateCall = (auth: Record<string, unknown>) => Promise<{ valid: boolean; error?: string }>;

/** What one piece becomes: its adapter, and one line for each part left out. */
export interface Mapping {
  /** The adapter the piece makes, or nothing when its auth is not one this plugin offers. */
  adapter?: Adapter;
  /** One line for each action, or each piece, the plugin does not offer. */
  notes: string[];
}

/**
 * The adapter one piece makes, and what was left out of it.
 *
 * An action its piece marks for humans alone is left out, as Activepieces
 * hides it from agent discovery. A connector is checked with the piece's own
 * `validate`, Activepieces' credential check, where the piece has one.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/docs/build-pieces/piece-reference/ai-metadata.mdx
 */
export function adapterOf(piece: PieceDescription, run?: RunCall, icon?: Icon, validate?: ValidateCall): Mapping {
  const name = nameOf(piece.package);
  if (name === undefined) {
    return { notes: [`${piece.package} is not a piece package, so it has no adapter`] };
  }
  const entries = entriesOf(piece.auth);
  const schema = schemaOf(entries);
  if (schema === undefined) {
    return { notes: [`${name}: the piece's auth is no secret text, basic auth or custom auth, so it has no adapter`] };
  }

  const notes: string[] = [];
  const capabilities: Capability[] = [];
  for (const action of piece.actions) {
    if (action.audience === 'human') continue;
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
    // The piece's own words, or its name where it wrote none.
    description: piece.description !== undefined && piece.description.trim() !== '' ? piece.description : piece.displayName,
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
      auth: authOf(entries, connector),
      input,
      ...(call?.files === undefined ? {} : { files: call.files }),
    });
  }
  if (validate !== undefined && entries.some((entry) => entry.validates === true)) {
    adapter.check = async (connector) => {
      try {
        const said = await validate(authOf(entries, connector));
        return said.valid ? { result: 'ok' } : { result: 'denied', ...(said.error === undefined ? {} : { message: said.error }) };
      }
      catch (error) {
        return { result: 'failed', message: error instanceof Error ? error.message : String(error) };
      }
    };
  }
  return { adapter, notes };
}
