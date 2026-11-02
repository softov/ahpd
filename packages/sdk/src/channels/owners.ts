/**
 * The rules two record channels share: whose record a connector or an agent is,
 * and where a secret field's value is kept.
 *
 * A connector and an agent are both a record one of three owners keeps -
 * `host`, `team:<team>` or `user:<id>` - and both take the same grant per verb
 * plus a rule of the owner's own on top: a host record takes `<subject>:host`,
 * a team record takes a membership of that team, and a person's record takes
 * that person. The two channels differ in the subject word, not in the rule,
 * so the rule is written once here and asked with the subject's name.
 *
 * A field an owner may not be shown is a secret: the value goes to the vault
 * under `<subject>/<id>/<field>` in the owner's scope, and the record keeps a
 * `{ "$secret": "<name>" }` instead. A kind may also keep a secret one level
 * down, under an object field such as an agent's `env`, which is what `nested`
 * turns on; a connector's config is flat and the flag is left off, so its
 * behaviour is exactly what it was before this module existed.
 */

import { fromEnvRef, scopeOf, secretRef } from '../access/vault.js';
import { INTERNAL_ERROR, INVALID_PARAMS, RpcError } from '../rpc.js';
import { membership } from '../usage/scopes.js';
import { bag, isRecord, reason } from '../utils/values.js';
import type { ConnectorOwner } from '../types/connectors.js';
import type { Grant, Principal } from '../types/users.js';
import type { Vault } from '../types/vault.js';

/** The gate's code for a grant a caller does not hold. */
export const DENIED = -32009;

/** What a client is shown in place of a secret, which is also what the schema is held against. */
export const HELD = '<set>';

/** What a caller may do to a record of an owner: make or change it, or remove it. */
export type OwnerVerb = 'put' | 'remove';

/** The noun a secret's vault name starts with, and the grant subject it is asked under. */
export type SecretSubject = 'connector' | 'agent' | 'tunnel';

/** How one subject names itself in a message about a secret. */
export interface SubjectWords {
  /** What starts a refusal, such as `A connector's`. */
  possessive: string;
  /** What the host's own record is called, such as `host connector`. */
  host: string;
}

/** How a connector is named in a message about one of its secrets. */
export const CONNECTOR_WORDS: SubjectWords = { possessive: "A connector's", host: 'host connector' };

/** How an agent is named in a message about one of its secrets. */
export const AGENT_WORDS: SubjectWords = { possessive: "An agent's", host: 'host agent' };

/** How a tunnel is named in a message about one of its secrets. */
export const TUNNEL_WORDS: SubjectWords = { possessive: "A tunnel's", host: 'host tunnel' };

/** How one channel reads and writes its secrets. */
export interface SecretRules {
  /** The noun a vault name starts with, and the grant subject. */
  subject: SecretSubject;
  /** How the subject names itself in a message. */
  words: SubjectWords;
  /**
   * Whether a secret may sit under an object field, as an agent's `env` does.
   *
   * Off, only a top-level vault field is a secret, which is what a connector's
   * config has always been.
   */
  nested: boolean;
}

/** A connector's secrets: flat, and named as a connector. */
export const CONNECTOR_SECRETS: SecretRules = { subject: 'connector', words: CONNECTOR_WORDS, nested: false };

/** An agent's secrets: a top-level field or one under `env`, and named as an agent. */
export const AGENT_SECRETS: SecretRules = { subject: 'agent', words: AGENT_WORDS, nested: true };

/** A tunnel's secrets: flat, and named as a tunnel. */
export const TUNNEL_SECRETS: SecretRules = { subject: 'tunnel', words: TUNNEL_WORDS, nested: false };

/** A value as a record's owner, or nothing when it names no scope. */
export const asOwner = (value: unknown): ConnectorOwner | undefined =>
  (typeof value === 'string' && /^(?:host|team:[^/]+|user:[^/]+)$/u.test(value) ? value as ConnectorOwner : undefined);

/** Whether this reader is on this team, by the same rule a team secret is written by. */
export const onTeam = (reader: Principal, team: string): boolean =>
  (reader.memberships ?? []).some((one) => membership(one)?.team === team);

/**
 * Whether this reader may make, check or remove a record of this owner.
 *
 * Every owner takes `<subject>:put` to be made and `<subject>:remove` to be
 * removed. A `host` record then takes `<subject>:host` as well. A
 * `team:<team>` record takes a membership of that team. A `user:<id>` record is
 * that person's own, and takes the caller to be that person. No reader is the
 * root connection or a host with no users directory, and both are the daemon
 * itself. A caller holding `config:write` is not let into a host's, a team's or
 * a person's record by it, which is why this is asked again in `handle` and not
 * only by the gate.
 */
export const ownerAllows = (
  subject: SecretSubject,
  owner: ConnectorOwner | undefined,
  reader: Principal | undefined,
  verb: OwnerVerb,
): boolean => {
  if (reader === undefined) return true;
  if (owner === undefined) return false;
  if (!reader.can(`${subject}:${verb}` as Grant)) return false;
  if (owner === 'host') return reader.can(`${subject}:host` as Grant);
  if (owner.startsWith('user:')) return reader.plugin === undefined && reader.id === owner.slice('user:'.length);
  return onTeam(reader, owner.slice('team:'.length));
};

/** Refuse one caller the owner's rule keeps out. */
export const refuseOwner = (
  subject: SecretSubject,
  doing: string,
  owner: ConnectorOwner,
  reader: Principal | undefined,
  verb: OwnerVerb,
): void => {
  if (ownerAllows(subject, owner, reader, verb)) return;
  throw new RpcError(DENIED, `${owner} is not ${reader?.id ?? 'this connection'}'s to ${doing}`);
};

/** The name a moved secret is kept under, in the owner's scope. */
export const secretNameOf = (subject: SecretSubject, owner: ConnectorOwner, id: string, field: string): string => {
  const rest = `${subject}/${id}/${field}`;
  if (owner === 'host') return `host:${rest}`;
  return `${owner}/${rest}`;
};

/**
 * Whether a schema node says its value is kept in the vault.
 *
 * `secret: true` is the keyword a vault field is marked with. `writeOnly` says
 * only that a read never answers the value, and a plugin written before
 * `secret` existed marks its vault fields with it: a node that says `writeOnly`
 * and nothing about `secret` is a vault field still, so such a plugin keeps
 * working. A node that says `secret: false` beside `writeOnly: true` is not
 * one: the plugin has said the value stays in the record, answered `<set>`.
 */
export const isSecret = (node: unknown): boolean => {
  if (!isRecord(node)) return false;
  if (node['secret'] === true) return true;
  return node['secret'] === undefined && node['writeOnly'] === true;
};

/** The top-level fields a schema says are kept in the vault: the values that are secrets. */
export const secretFields = (schema: Record<string, unknown>): string[] => {
  const properties = bag(schema['properties']);
  return Object.entries(properties)
    .filter(([, one]) => isSecret(one))
    .map(([field]) => field);
};

/** One path below another, with a dot only when there is a parent. */
const under = (base: string, tail: string): string => (base === '' ? tail : `${base}.${tail}`);

/**
 * The path of every value a schema says is kept in the vault, at any depth, in the configs given.
 *
 * A property, a value of `additionalProperties` and an item of a list are each
 * walked, so a key inside one entry of a list is a secret as a top-level field
 * is. A list item and a map key are named by what the configs hold, so the
 * same schema gives `sources.0.key` for one config and nothing for another. A
 * path either config reaches is named: the old record's, so a secret of an
 * entry that went is taken out, and the new one's, so a new entry's is kept.
 * The walk goes only as deep as a config does, so a schema that names itself
 * ends where the value ends.
 */
export const secretPaths = (
  schema: Record<string, unknown>,
  ...configs: Record<string, unknown>[]
): string[] => {
  const found = new Set<string>();
  const walk = (node: unknown, value: unknown, path: string): void => {
    if (!isRecord(node)) return;
    if (isSecret(node) && path !== '') { found.add(path); return; }
    if (isRecord(value)) {
      const properties = bag(node['properties']);
      for (const [key, one] of Object.entries(properties)) walk(one, value[key], under(path, key));
      const additional = node['additionalProperties'];
      if (isRecord(additional)) {
        for (const [key, one] of Object.entries(value)) {
          if (key in properties) continue;
          walk(additional, one, under(path, key));
        }
      }
    }
    if (Array.isArray(value) && isRecord(node['items'])) {
      value.forEach((one, position) => { walk(node['items'], one, under(path, String(position))); });
    }
  };
  for (const config of configs) walk(schema, config, '');
  return [...found];
};

/** Whether one part of a dotted path is a position in a list. */
const isPosition = (part: string): boolean => /^(0|[1-9]\d*)$/u.test(part);

/** One step down a dotted path: a field of an object, or a position in a list. */
const step = (held: unknown, part: string): unknown => {
  if (isRecord(held)) return held[part];
  if (Array.isArray(held) && isPosition(part)) return held[Number(part)];
  return undefined;
};

/** The object a dotted path's last part is written in, when the path reaches one. */
const parentAt = (config: Record<string, unknown>, parts: readonly string[]): Record<string, unknown> | undefined => {
  let held: unknown = config;
  for (const part of parts) held = step(held, part);
  return isRecord(held) ? held : undefined;
};

/** One value, deep-copied, so a written record shares nothing with what a caller sent. */
const clone = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((one) => clone(one));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, one] of Object.entries(value)) out[key] = clone(one);
    return out;
  }
  return value;
};

/** The value at one dotted path, or nothing when the path does not reach one. */
const at = (config: Record<string, unknown>, path: string): unknown => {
  let held: unknown = config;
  for (const part of path.split('.')) held = step(held, part);
  return held;
};

/** Write one dotted path, leaving the config alone when its parent is not an object. */
const putAt = (config: Record<string, unknown>, path: string, value: unknown): void => {
  const parts = path.split('.');
  const last = parts.pop();
  if (last === undefined) return;
  const held = parentAt(config, parts);
  if (held !== undefined) held[last] = value;
};

/** Take one dotted path out, leaving the config alone when its parent is not an object. */
const removeAt = (config: Record<string, unknown>, path: string): void => {
  const parts = path.split('.');
  const last = parts.pop();
  if (last === undefined) return;
  const held = parentAt(config, parts);
  if (held !== undefined) delete held[last];
};

/**
 * Whether the entry a list secret sits in is the entry it was kept for.
 *
 * A list secret is named by its position, so an entry that moves takes its
 * position's secret, not its own. An empty field keeps a secret only where
 * every other field of its entry is as it was. Elsewhere the person sends the
 * value again, and a key never follows a position to another endpoint.
 */
const sameEntry = (config: Record<string, unknown>, held: Record<string, unknown>, path: string): boolean => {
  const parts = path.split('.');
  if (!parts.some(isPosition)) return true;
  const now = parentAt(config, parts.slice(0, -1));
  const was = parentAt(held, parts.slice(0, -1));
  if (now === undefined || was === undefined) return false;
  // A secret and an empty field read alike on both sides: the rest is compared.
  const plain = (value: unknown): unknown => {
    if (value === '' || secretRef(value) !== undefined) return HELD;
    if (Array.isArray(value)) return value.map(plain);
    if (!isRecord(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, plain(value[key])]));
  };
  return JSON.stringify(plain(now)) === JSON.stringify(plain(was));
};

/** The read of a field, by whether the rules allow a secret under an object. */
const readField = (config: Record<string, unknown>, field: string, nested: boolean): unknown =>
  (nested ? at(config, field) : config[field]);

/** A record's config with each moved secret stood in for by what a client is shown. */
export const heldAgainst = (config: Record<string, unknown>, rules: SecretRules): Record<string, unknown> => {
  if (!rules.nested) {
    const out: Record<string, unknown> = { ...config };
    for (const [field, value] of Object.entries(out)) {
      if (secretRef(value) !== undefined || fromEnvRef(value) !== undefined) out[field] = HELD;
    }
    return out;
  }
  const hold = (value: unknown): unknown => {
    if (secretRef(value) !== undefined || fromEnvRef(value) !== undefined) return HELD;
    if (Array.isArray(value)) return value.map((one) => hold(one));
    if (isRecord(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, one] of Object.entries(value)) out[key] = hold(one);
      return out;
    }
    return value;
  };
  return hold(config) as Record<string, unknown>;
};

/**
 * A stored config with every field that holds a reference left out: a
 * `$secret` the vault keeps, or a `$env` this host reads.
 *
 * What a place handed nothing of this host's vault and environment is given,
 * where `heldAgainst` would hand it a marker in the field's place.
 */
export const withoutSecrets = (config: Record<string, unknown>, rules: SecretRules): Record<string, unknown> => {
  const held = (value: unknown): boolean => secretRef(value) !== undefined || fromEnvRef(value) !== undefined;
  if (!rules.nested) return Object.fromEntries(Object.entries(config).filter(([, value]) => !held(value)));
  const drop = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.filter((one) => !held(one)).map((one) => drop(one));
    if (isRecord(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, one] of Object.entries(value)) if (!held(one)) out[key] = drop(one);
      return out;
    }
    return value;
  };
  return drop(config) as Record<string, unknown>;
};

/**
 * The config a put is checked against: each reference held, and an empty field
 * that keeps a secret held too.
 *
 * A client is never given a secret to send back, so the field comes back empty
 * and the record keeps the one it had. Checked as `HELD`, the rules a person
 * filled the value in under are asked of the record, and a value nobody may
 * read is never read to ask them.
 */
export const checkedConfig = (
  config: Record<string, unknown>,
  rules: SecretRules,
  fields: readonly string[],
  kept: Record<string, unknown>,
): Record<string, unknown> => {
  const out = heldAgainst(config, rules);
  for (const field of fields) {
    if (readField(config, field, rules.nested) !== '') continue;
    if (secretRef(readField(kept, field, rules.nested)) === undefined) continue;
    if (rules.nested) putAt(out, field, HELD); else out[field] = HELD;
  }
  return out;
};

/**
 * The config a record is opened with: each reference read back.
 *
 * A `$secret` is read from the vault, and a `fromEnv` from the daemon's own
 * environment. A variable that is not set, or is set empty, is refused the way
 * a vault that holds no name is. A `fromEnv` in a record that is not the host's
 * is refused before the variable is read, as a put refuses it: a record written
 * straight into the collection never reaches the check.
 */
export const resolved = async (
  config: Record<string, unknown>,
  owner: ConnectorOwner,
  vault: Vault | undefined,
  rules: SecretRules,
): Promise<Record<string, unknown>> => {
  if (!rules.nested) {
    const out: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(config)) {
      const name = secretRef(value);
      if (name !== undefined) {
        const held = await vault?.get(name);
        if (held === undefined) throw new Error(`the vault holds no ${name}`);
        out[field] = held;
        continue;
      }
      const variable = fromEnvRef(value);
      if (variable !== undefined) {
        if (owner !== 'host') {
          throw new Error(`${rules.words.possessive} ${field} may read the daemon's environment only for a ${rules.words.host}`);
        }
        const held = process.env[variable];
        if (held === undefined || held === '') throw new Error(`the environment holds no ${variable}`);
        out[field] = held;
        continue;
      }
      out[field] = value;
    }
    return out;
  }
  const walk = async (value: unknown, path: string): Promise<unknown> => {
    const name = secretRef(value);
    if (name !== undefined) {
      const held = await vault?.get(name);
      if (held === undefined) throw new Error(`the vault holds no ${name}`);
      return held;
    }
    const variable = fromEnvRef(value);
    if (variable !== undefined) {
      if (owner !== 'host') {
        throw new Error(`${rules.words.possessive} ${path} may read the daemon's environment only for a ${rules.words.host}`);
      }
      const held = process.env[variable];
      if (held === undefined || held === '') throw new Error(`the environment holds no ${variable}`);
      return held;
    }
    if (Array.isArray(value)) return Promise.all(value.map((one, position) => walk(one, `${path}.${position}`)));
    if (isRecord(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, one] of Object.entries(value)) out[key] = await walk(one, path === '' ? key : `${path}.${key}`);
      return out;
    }
    return value;
  };
  return await walk(config, '') as Record<string, unknown>;
};

/** Take one secret out of the vault, saying so and going on when the store refuses. */
export const forget = async (
  vault: Vault | undefined,
  name: string,
  id: string,
  problem: (message: string) => void,
): Promise<void> => {
  if (vault === undefined) return;
  try {
    await vault.delete(name);
  } catch (error) {
    problem(`${id}'s secret ${name} could not be taken out: ${reason(error)}`);
  }
};

/** Every secret reference a config holds, with the field or path it sits at. */
export const secretRefs = (config: Record<string, unknown>, nested: boolean): { path: string; name: string }[] => {
  const found: { path: string; name: string }[] = [];
  if (!nested) {
    for (const [field, value] of Object.entries(config)) {
      const name = secretRef(value);
      if (name !== undefined) found.push({ path: field, name });
    }
    return found;
  }
  const walk = (value: unknown, path: string): void => {
    const name = secretRef(value);
    if (name !== undefined) { found.push({ path, name }); return; }
    if (Array.isArray(value)) { value.forEach((one, position) => walk(one, `${path}.${position}`)); return; }
    if (isRecord(value)) {
      for (const [key, one] of Object.entries(value)) walk(one, path === '' ? key : `${path}.${key}`);
    }
  };
  walk(config, '');
  return found;
};

/** Take every secret a removed record names out, and only the ones its own owner put there. */
export const forgetAll = async (
  config: Record<string, unknown>,
  owner: ConnectorOwner | undefined,
  id: string,
  rules: SecretRules,
  vault: Vault | undefined,
  problem: (message: string) => void,
): Promise<void> => {
  for (const { path, name } of secretRefs(config, rules.nested)) {
    if (owner !== undefined && name !== secretNameOf(rules.subject, owner, id, path)) continue;
    await forget(vault, name, id, problem);
  }
};

/** What a put keeps of its secrets, and what it takes out. */
export interface MoveSecretsOptions {
  /** How the subject reads and names its secrets. */
  rules: SecretRules;
  /** The field or path of each secret the subject's schema names. */
  fields: readonly string[];
  /** What the client sent. */
  config: Record<string, unknown>;
  /** What the record held before, or an empty object when the owner changed. */
  held: Record<string, unknown>;
  /** The owner the record is kept for. */
  owner: ConnectorOwner;
  /** The record's id. */
  id: string;
  /** The vault a secret is kept in. */
  vault: Vault | undefined;
  /** Where a secret that cannot be taken out is said. */
  problem(message: string): void;
}

/**
 * The config a put keeps: each secret moved, and a reference kept in its place.
 *
 * `held` is what the record held before, and it is read only when the owner is
 * the same: a record that changed hands takes none of its old secrets with it.
 * A field sent empty keeps the secret it already had, because a client is never
 * given one to send back; a field left out drops its secret, which is what a
 * record written whole does.
 */
export const moveSecrets = async (options: MoveSecretsOptions): Promise<Record<string, unknown>> => {
  const { rules, fields, config, held, owner, id, vault, problem } = options;
  const out = (rules.nested ? clone(config) : { ...config }) as Record<string, unknown>;
  for (const field of fields) {
    const value = readField(config, field, rules.nested);
    const was = secretRef(readField(held, field, rules.nested));
    const mine = was !== undefined && was === secretNameOf(rules.subject, owner, id, field);
    if (value === undefined) {
      if (rules.nested) removeAt(out, field); else delete out[field];
      if (mine) await forget(vault, was, id, problem);
      continue;
    }
    const named = secretRef(value);
    if (named !== undefined) {
      /*
       * A host's agent may name a host secret, as it may name a variable of the
       * daemon: both are the host's own. Anyone else could name a secret that
       * is not theirs, so they send the value.
       */
      if (rules.nested && owner === 'host' && named.startsWith('host:')) {
        if (mine) await forget(vault, was, id, problem);
        putAt(out, field, { $secret: named });
        continue;
      }
      throw new RpcError(INVALID_PARAMS, `${rules.words.possessive} ${field} is a secret: send its value, not a reference to it`);
    }
    const variable = fromEnvRef(value);
    if (variable !== undefined) {
      /*
       * Only a host's record may name one: the daemon's environment is nobody's
       * own, and a person's record that read it could send any variable of the
       * daemon to an endpoint they choose.
       */
      if (owner !== 'host') {
        throw new RpcError(INVALID_PARAMS, `${rules.words.possessive} ${field} may read the daemon's environment only for a ${rules.words.host}`);
      }
      if (mine) await forget(vault, was, id, problem);
      if (rules.nested) putAt(out, field, { fromEnv: variable }); else out[field] = { fromEnv: variable };
      continue;
    }
    if (value === '') {
      if (!mine) { if (rules.nested) removeAt(out, field); else delete out[field]; continue; }
      if (rules.nested && !sameEntry(config, held, field)) {
        throw new RpcError(INVALID_PARAMS, `${rules.words.possessive} ${field} sits in an entry that changed: send its value again`);
      }
      if (rules.nested) putAt(out, field, { $secret: was }); else out[field] = { $secret: was };
      continue;
    }
    if (typeof value !== 'string') {
      throw new RpcError(INVALID_PARAMS, `${rules.words.possessive} ${field} is a secret, so it is sent as a string`);
    }
    const name = secretNameOf(rules.subject, owner, id, field);
    try {
      scopeOf(name);
    } catch (error) {
      throw new RpcError(INVALID_PARAMS, reason(error));
    }
    if (vault === undefined) throw new RpcError(INTERNAL_ERROR, 'This host has no vault, so a secret cannot be kept');
    await vault.set(name, value);
    if (rules.nested) putAt(out, field, { $secret: name }); else out[field] = { $secret: name };
  }
  return out;
};
