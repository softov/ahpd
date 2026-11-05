import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installSsrfGuard } from './guard.ts';
import { inputOf } from './props.ts';
import type { Props } from './props.ts';
import type { ActionDescription, Answer, AuthDescription, PieceDescription, PropDescription, Request, RunRequest, Store } from './wire.js';

/**
 * The engine: the process that loads Activepieces pieces and runs their
 * actions, as Activepieces' own engine does.
 *
 * A piece bundles its own HTTP client, and that client turns off TLS checks for
 * the whole process on every request. The daemon cannot have that, so a piece
 * runs here instead: a process of its own, with `process.env` pinned against a
 * write or a delete of `NODE_TLS_REJECT_UNAUTHORIZED`.
 *
 * The plugin asks what the pieces it named are, and for one action of one of
 * them, which runs as Activepieces runs a single action outside a flow. Nothing
 * here is exported: this file is an entry, run by `fork`, and it exits when the
 * channel to the plugin closes.
 */

/** The key a piece turns the certificate check off with, which this process pins. */
const PINNED = 'NODE_TLS_REJECT_UNAUTHORIZED';

/** One line saying what went wrong, without a stack. */
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Whether a value is a plain record. */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Pin `NODE_TLS_REJECT_UNAUTHORIZED` before any piece loads.
 *
 * A proxy over `process.env` passes every key through but that one, and it
 * ignores a write, a define and a delete of it, so a piece cannot turn the
 * check off and nothing else notices the proxy. The value the daemon started
 * with stays.
 */
const pinTls = (): void => {
  const held = process.env;
  process.env = new Proxy(held, {
    set(target, key, value: unknown): boolean {
      if (key === PINNED) return true;
      return Reflect.set(target, key, value);
    },
    defineProperty(target, key, descriptor): boolean {
      if (key === PINNED) return true;
      return Reflect.defineProperty(target, key, descriptor);
    },
    deleteProperty(target, key): boolean {
      if (key === PINNED) return true;
      return Reflect.deleteProperty(target, key);
    },
  });
};

pinTls();

// The SSRF guard, before any piece loads, as the engine installs it at start.
installSsrfGuard();

/** The values of a static dropdown, or nothing when the prop is not one. */
const staticOptions = (prop: Record<string, unknown>): unknown[] | undefined => {
  const options = prop['options'];
  if (!isRecord(options)) return undefined;
  const listed = options['options'];
  if (!Array.isArray(listed)) return undefined;
  return listed.filter(isRecord).map((one) => one['value']);
};

/**
 * One record of props, each as its type, names, required flag, static options
 * and, for an array, the props of one item.
 *
 * The framework writes an array prop's item props as its `properties`, so an
 * array of objects is told apart from a plain list of strings here.
 */
const describeProps = (props: unknown): Record<string, PropDescription> => {
  const out: Record<string, PropDescription> = {};
  if (!isRecord(props)) return out;
  for (const [name, value] of Object.entries(props)) {
    if (!isRecord(value)) continue;
    const one: PropDescription = {
      type: typeof value['type'] === 'string' ? value['type'] : 'SHORT_TEXT',
      displayName: typeof value['displayName'] === 'string' ? value['displayName'] : name,
      required: value['required'] === true,
    };
    if (typeof value['description'] === 'string') one.description = value['description'];
    const options = staticOptions(value);
    if (options !== undefined) one.options = options;
    if (one.type === 'ARRAY' && isRecord(value['properties'])) {
      const sub = describeProps(value['properties']);
      if (Object.keys(sub).length > 0) one.props = sub;
    }
    out[name] = one;
  }
  return out;
};

/** One auth, as its type, names, description and fields. */
const describeAuthOne = (auth: Record<string, unknown>): AuthDescription => {
  const one: AuthDescription = {
    type: typeof auth['type'] === 'string' ? auth['type'] : 'UNKNOWN',
    displayName: typeof auth['displayName'] === 'string' ? auth['displayName'] : 'Connection',
  };
  if (typeof auth['description'] === 'string') one.description = auth['description'];
  if (isRecord(auth['props'])) one.props = describeProps(auth['props']);
  return one;
};

/** The auth a piece takes: one entry, each entry of a list, or nothing. */
const describeAuth = (auth: unknown): AuthDescription | AuthDescription[] | undefined => {
  if (Array.isArray(auth)) return auth.filter(isRecord).map(describeAuthOne);
  if (isRecord(auth)) return describeAuthOne(auth);
  return undefined;
};

/** One action, as its name, names, description and props. */
const describeAction = (name: string, action: Record<string, unknown>): ActionDescription => {
  const one: ActionDescription = {
    name: typeof action['name'] === 'string' ? action['name'] : name,
    displayName: typeof action['displayName'] === 'string' ? action['displayName'] : name,
    description: typeof action['description'] === 'string' ? action['description'] : '',
    props: describeProps(action['props']),
  };
  const ai = action['aiMetadata'];
  if (isRecord(ai) && typeof ai['description'] === 'string') one.aiDescription = ai['description'];
  return one;
};

/** Each action of a piece, in the order the piece declares them. */
const describeActions = (actions: unknown): ActionDescription[] => {
  if (!isRecord(actions)) return [];
  return Object.entries(actions)
    .filter(([, action]) => isRecord(action))
    .map(([name, action]) => describeAction(name, action as Record<string, unknown>));
};

/** Whether a value is the piece a module exports: the object that holds `_actions`. */
const isPiece = (value: unknown): value is Record<string, unknown> => isRecord(value) && isRecord(value['_actions']);

/**
 * The piece one module exports.
 *
 * A piece bundles its own copy of the framework, so it is found by the
 * `_actions` member it carries rather than by an `instanceof` of a class this
 * process was built against. A CommonJS piece answers its exports under
 * `default`; a package may also re-export its own helpers beside it.
 */
const pieceOf = (module: Record<string, unknown>): Record<string, unknown> => {
  const candidates = Object.values(module);
  if (isRecord(module['default'])) candidates.push(...Object.values(module['default']));
  const found = candidates.find(isPiece);
  if (found === undefined) throw new Error('the module exports no piece');
  return found;
};

/** One piece that loaded, and the version of the package it came from, when its manifest says one. */
interface Loaded {
  piece: Record<string, unknown>;
  version?: string;
}

/** The pieces that loaded so far, by the specifier they were asked for by. */
const loaded = new Map<string, Loaded>();

/** The file one package resolves to inside `installed/`, if it is there. */
const fromInstalled = (spec: string, installed: string): string | undefined => {
  try {
    return createRequire(join(installed, 'package.json')).resolve(spec);
  }
  catch {
    return undefined;
  }
};

/**
 * The version the package of one imported file says, read from the first
 * `package.json` above it that names the package.
 */
const versionAbove = (spec: string, file: string): string | undefined => {
  for (let folder = dirname(file); dirname(folder) !== folder; folder = dirname(folder)) {
    let manifest: unknown;
    try {
      manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    }
    catch {
      continue;
    }
    if (isRecord(manifest) && manifest['name'] === spec) return typeof manifest['version'] === 'string' ? manifest['version'] : undefined;
  }
  return undefined;
};

/** One module, and the file it was imported from. */
interface Imported {
  module: Record<string, unknown>;
  file: string | undefined;
}

/** The file Node imports a specifier from, or nothing for one it cannot resolve. */
const resolvedFile = (spec: string): string | undefined => {
  try {
    const url = import.meta.resolve(spec);
    return url.startsWith('file:') ? fileURLToPath(url) : undefined;
  }
  catch {
    return undefined;
  }
};

/**
 * Import one piece by its package name.
 *
 * The name is imported as it is, so Node finds a piece the plugin depends on
 * the way it finds any dependency. A piece the plugin installed is in the
 * plugin's own `installed/` folder instead, which is not on that path, so a
 * name that did not resolve is looked up there and imported from the file it
 * resolves to. A name that neither holds is the first failure, because that is
 * the line that says what the plugin's own resolution did.
 */
const imported = async (spec: string, installed: string | undefined, first: boolean): Promise<Imported> => {
  if (first && installed !== undefined) {
    const at = fromInstalled(spec, installed);
    if (at !== undefined) return { module: await import(pathToFileURL(at).href) as Record<string, unknown>, file: at };
  }
  try {
    return { module: await import(spec) as Record<string, unknown>, file: resolvedFile(spec) };
  }
  catch (error) {
    if (installed === undefined) throw error;
    const at = fromInstalled(spec, installed);
    if (at === undefined) throw error;
    return { module: await import(pathToFileURL(at).href) as Record<string, unknown>, file: at };
  }
};

/** The piece one specifier names, loaded once and kept for the next call. */
const loadedPiece = async (spec: string, installed: string | undefined, first = false): Promise<Loaded> => {
  const held = loaded.get(spec);
  if (held !== undefined) return held;
  const { module, file } = await imported(spec, installed, first);
  const version = file === undefined ? undefined : versionAbove(spec, file);
  const piece: Loaded = { piece: pieceOf(module), ...(version === undefined ? {} : { version }) };
  loaded.set(spec, piece);
  return piece;
};

/** Load one piece, once, and describe it. */
const describePiece = async (spec: string, installed: string | undefined, first: boolean): Promise<PieceDescription> => {
  const { piece } = await loadedPiece(spec, installed, first);
  const one: PieceDescription = {
    package: spec,
    displayName: typeof piece['displayName'] === 'string' ? piece['displayName'] : spec,
    actions: describeActions(piece['_actions']),
  };
  if (typeof piece['description'] === 'string') one.description = piece['description'];
  // The logo is a URL a client cannot draw from here: the parent fetches it
  // once and sends it on as a data: icon.
  if (typeof piece['logoUrl'] === 'string') one.logoUrl = piece['logoUrl'];
  const auth = describeAuth(piece['auth']);
  if (auth !== undefined) one.auth = auth;
  return one;
};

/** Answer a `describe`: each piece that loaded, and one line for each that did not. */
const describe = async (id: number, pieces: string[], installed: string | undefined, first: string[]): Promise<Answer> => {
  const found: PieceDescription[] = [];
  const errors: string[] = [];
  for (const spec of pieces) {
    try {
      found.push(await describePiece(spec, installed, first.includes(spec)));
    } catch (error) {
      errors.push(`${spec}: ${reason(error)}`);
    }
  }
  return { type: 'described', id, pieces: found, errors };
};

/** Each connector's store, in memory until this process exits. */
const stores = new Map<string, Store>();

/** The store one connector keeps: the values only its own calls read and write. */
const storeOf = (connector: string): Store => {
  const held = stores.get(connector);
  if (held !== undefined) return held;
  const values = new Map<string, unknown>();
  const store: Store = {
    put: async <T>(key: string, value: T): Promise<T> => {
      values.set(key, value);
      return value;
    },
    get: async <T>(key: string): Promise<T | null> => (values.has(key) ? values.get(key) as T : null),
    delete: async (key: string): Promise<void> => {
      values.delete(key);
    },
  };
  stores.set(connector, store);
  return store;
};

/** An error saying this plugin offers no such part of the framework. */
const notOffered = (what: string): never => {
  throw new Error(`this plugin does not offer ${what}`);
};

/** An object that answers that error on any member a piece reads. */
const refused = (what: string): Record<string, unknown> =>
  new Proxy({}, {
    get(): never {
      return notOffered(what);
    },
  });

/** The characters a written file's name may not hold, each written as `-`. */
const UNSAFE_NAME = /[^A-Za-z0-9._-]+/gu;

/** The longest a written file's name is, its extension included. */
const LONGEST_NAME = 80;

/** The bytes a piece writes, or the refusal when it hands something else. */
const bytesOf = (data: unknown): Buffer => {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (typeof data === 'string') return Buffer.from(data);
  throw new Error('a file is written from bytes');
};

/**
 * A file's name as one path segment, or `file` when nothing is left.
 *
 * The same length the host's own attachments are named to, and cut before the
 * extension so the extension survives the cut.
 */
const safeName = (named: string): string => {
  const base = basename(named).replace(UNSAFE_NAME, '-').replace(/^-+|-+$/gu, '');
  const extension = extname(base);
  const stem = base.slice(0, base.length - extension.length);
  const held = `${stem.slice(0, Math.max(0, LONGEST_NAME - extension.length))}${extension}`;
  return held === '' || held === '.' || held === '..' ? 'file' : held;
};

/**
 * The `files` service one call runs with.
 *
 * `write` puts the bytes in the call's folder, under the basename of the name
 * the piece asked for, and answers the absolute path. A name another call
 * already wrote gets a number before its extension. The file is created with
 * `wx`, so an existing file is never replaced.
 */
const filesIn = (folder: string): Record<string, unknown> => ({
  write: async (asked: { fileName?: unknown; data?: unknown }): Promise<string> => {
    const named = safeName(typeof asked.fileName === 'string' ? asked.fileName : 'file');
    const bytes = bytesOf(asked.data);
    const extension = extname(named);
    const stem = named.slice(0, named.length - extension.length);
    await mkdir(folder, { recursive: true, mode: 0o700 });
    for (let count = 0; ; count++) {
      const path = resolve(folder, count === 0 ? named : `${stem}-${String(count)}${extension}`);
      try {
        await writeFile(path, bytes, { flag: 'wx', mode: 0o400 });
        return path;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
        // The path stays out of the message: the folder is the host's, and a
        // piece is not told where a session keeps its files.
        throw new Error('the file could not be written');
      }
    }
  },
});

/**
 * The step an action run is, which Activepieces names `step_1`.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/api/src/app/mcp/tools/flow-run-utils.ts
 */
const ACTION_RUN_STEP_NAME = 'step_1';

/**
 * What an action run refuses a waitpoint with: it cannot pause, because no flow
 * is there to resume.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/engine/src/lib/handler/piece-executor.ts#L340-L344
 */
const cannotSuspend = (): never => {
  throw new Error('This action pauses the run (waitpoint) and can only run inside a flow, not as a action run.');
};

/**
 * The context one action runs with, built from the request alone, as the
 * engine builds an action run's.
 *
 * A piece reads `auth` and `propsValue`, and may keep a value in `store`. The
 * run cannot pause, so `canPause` is false and a waitpoint is refused; the
 * step is `step_1`. The rest is a stub: the plugin runs one action, not a flow,
 * so a piece that reaches for a connection or the server is told that it is
 * not here. `files` writes into the call's folder, and a call with no folder
 * refuses it.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/engine/src/lib/handler/piece-executor.ts#L91-L141
 */
const contextOf = (request: RunRequest, input: Record<string, unknown>): Record<string, unknown> => ({
  auth: request.auth,
  propsValue: input,
  store: storeOf(request.connector),
  step: { name: ACTION_RUN_STEP_NAME },
  project: { id: request.connector, externalId: async () => request.connector },
  executionType: 'BEGIN',
  flows: {
    list: async () => notOffered('flows'),
    current: { id: request.connector, version: { id: request.action } },
  },
  tags: { add: async () => undefined },
  output: { update: async () => undefined },
  run: {
    id: `run-${request.id}`,
    canPause: false,
    stop: () => undefined,
    respond: () => undefined,
    createWaitpoint: async () => cannotSuspend(),
    waitForWaitpoint: () => cannotSuspend(),
  },
  files: request.files === undefined ? refused('files') : filesIn(request.files),
  connections: refused('connections'),
  server: refused('server'),
});

/**
 * One action of a piece by name, or the engine's refusal of an action its
 * piece lacks, naming the piece and the version that loaded.
 * https://github.com/activepieces/activepieces/blob/0a2f7057077cecdc2f014c03475f4b19ecd5dcb8/packages/server/engine/src/lib/helper/piece-loader.ts
 */
const actionOf = (held: Loaded, request: RunRequest): Record<string, unknown> => {
  const actions = held.piece['_actions'];
  if (isRecord(actions) && isRecord(actions[request.action])) return actions[request.action] as Record<string, unknown>;
  throw new Error(`Action not found for piece ${request.piece}${held.version === undefined ? '' : `@${held.version}`}`);
};

/** Answer a `run`: the action's result, or the message of what it threw. */
const answerRun = async (request: RunRequest): Promise<Answer> => {
  const piece = await loadedPiece(request.piece, request.installed, request.installedFirst === true);
  const action = actionOf(piece, request);
  const perform = action['run'];
  if (typeof perform !== 'function') throw new Error(`the action ${request.action} cannot run`);
  const input = await inputOf(isRecord(action['props']) ? action['props'] as Props : {}, request.input, request.files);
  const result = await (perform as (context: Record<string, unknown>) => unknown)(contextOf(request, input));
  return { type: 'ran', id: request.id, result: result === undefined ? null : result };
};

/** Answer one request from the parent. */
const handle = async (request: Request): Promise<void> => {
  const answer = request.type === 'describe'
    ? await describe(request.id, request.pieces, request.installed, request.installedFirst ?? [])
    : await answerRun(request);
  process.send?.(answer);
};

process.on('message', (message: Request) => {
  handle(message).catch((error: unknown) => {
    process.send?.({ type: 'failed', id: message.id, message: reason(error) });
  });
});

/*
 * The daemon exits, or stops the plugin, and the channel closes. A piece has
 * nothing to settle after that, and an engine that stayed would outlive the
 * daemon that started it.
 */
process.on('disconnect', () => { process.exit(0); });
