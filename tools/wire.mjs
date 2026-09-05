/*
 * What this host actually sent, against what the protocol actually declares.
 *
 * A grep over construction sites cannot answer this. A conditional spread -
 * `...(x ? { model } : {})` - defeats TypeScript's excess-property check, so a
 * codebase can be typed against the package and still put an undeclared field
 * on the wire; and a check that compares a key against every name declared
 * *anywhere* passes any name that is legal somewhere, which is most of them.
 * Both failures are invisible in the source and obvious in a capture.
 *
 * So: the strict schema from `schema.mjs`, ajv, and a recording. It reports
 * undeclared keys and missing required ones together, which are the two ways
 * an implementation drifts from its own specification.
 *
 * The module rather than the command, so the same check runs in the suite -
 * over frames the tests just produced - and over a capture taken off a real
 * daemon with `tools/validate.mjs`.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const Ajv = require('ajv/dist/2020.js').default ?? require('ajv/dist/2020.js');
const addFormats = require('ajv-formats').default ?? require('ajv-formats');

/** Where `schema.mjs` writes, which is where this reads. */
export const SCHEMA = new URL('./ahp.strict.schema.json', import.meta.url);

/**
 * Which declaration a channel's state is.
 *
 * By URI scheme, because that is what the protocol routes on. A chat is the
 * awkward one: hosts spell it `ahp-chat:/<session>` and
 * `ahp-chat://default/<base64>`, and both are the same channel kind.
 */
export function stateFor(resource) {
  if (typeof resource !== 'string') return undefined;
  if (resource.startsWith('ahp-root:')) return 'RootState';
  if (resource.startsWith('ahp-chat:')) return 'ChatState';
  if (resource.startsWith('ahp-automations:')) return 'AutomationState';
  if (resource.startsWith('ahp-automation-run:')) return 'AutomationRunState';
  // A terminal's scheme is the host's own - `agenthost-terminal:` from one,
  // `ahp-terminal:` from another - so it is matched on the part that is the
  // channel kind rather than on a whole scheme somebody chose.
  if (/^[a-z-]*terminal:/.test(resource)) return 'TerminalState';
  if (resource.includes('/annotations')) return 'AnnotationsState';
  if (resource.includes('/changeset')) return 'ChangesetState';
  if (resource.startsWith('ahp-resource-watch:')) return 'ResourceWatchState';
  /*
   * Everything else addressed by a provider scheme is a session: the scheme is
   * the provider's own - `claude:/…`, `ahp-session:/…` - so it cannot be
   * matched by name and has to be the default.
   *
   * Which makes the default greedy, and it has to be fenced. `ahp-otlp://logs`
   * is a stateless signal channel with no state declaration at all, and it
   * fell through to here and reported a session missing every field it has.
   * A finding that is the router's fault is worse than no finding: it is the
   * one thing that would get this switched off. Any other `ahp-` scheme is
   * something this does not know about and says so rather than guessing.
   */
  if (resource.startsWith('ahp-session:')) return 'SessionState';
  if (/^ahp-[a-z-]+:/.test(resource)) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:\/[^/]/.test(resource)) return undefined;
  return 'SessionState';
}

/**
 * The branch that was meant, out of a union that failed.
 *
 * A discriminated union fails every branch but one, and ajv reports all of
 * them - so one undeclared key on a customization arrives as a wall of `type
 * const must be equal to constant` from the seventeen kinds it is not. The
 * branch whose discriminant *matched* is the one the sender intended, and its
 * errors are the only real ones; the rest are the union working correctly.
 *
 * Where no branch matches its discriminant the value belongs to none of them,
 * which is a genuine finding, and the umbrella error is kept.
 */
function narrow(errors) {
  // Branches are `$ref`s, so ajv's `schemaPath` names the definition each
  // error came from rather than a branch index - which is the handle here.
  const defOf = (error) => (error.schemaPath.match(/\$defs\/([^/]+)/) ?? [])[1] ?? '';
  const discriminant = /\/(type|kind|status|state)$/;

  const dropped = new Set();
  // Deepest first, so a union inside a union is resolved from the inside out.
  const unions = errors.filter((one) => one.keyword === 'anyOf')
    .sort((a, b) => b.instancePath.length - a.instancePath.length);

  for (const union of unions) {
    const at = union.instancePath;
    const under = errors.filter((one) => one !== union && !dropped.has(one)
      && one.instancePath.startsWith(at));
    const branches = new Map();
    for (const one of under) {
      const name = defOf(one);
      branches.set(name, [...(branches.get(name) ?? []), one]);
    }
    const intended = [...branches].filter(([, kept]) => !kept.some(
      (one) => one.keyword === 'const' && discriminant.test(one.instancePath),
    ));
    // Every branch ruled itself out by its discriminant: the value is none of
    // them, which is a real finding, so the union failure stands whole.
    if (intended.length === 0 || intended.length === branches.size) continue;
    for (const [name, kept] of branches) {
      if (intended.some(([one]) => one === name)) continue;
      for (const one of kept) dropped.add(one);
    }
    dropped.add(union);
  }
  return errors.filter((one) => !dropped.has(one));
}

/** The declaration an action's payload is, from the type it carries. */
const actionDef = (type) =>
  `${type.split('/').map((part) => part[0].toUpperCase() + part.slice(1)).join('')}Action`;

/**
 * A checker over one strict schema.
 *
 * `frame(value)` takes one protocol frame and answers the defects in it:
 * `{ def, at, what, sample }` each, where `at` has array indices folded to
 * `N` so one bad conversation is one finding rather than hundreds. `skipped`
 * counts the payloads nothing here knows how to route, which is the part of
 * the surface this is *not* checking and says so.
 */
export function checker(schema = JSON.parse(readFileSync(SCHEMA, 'utf8'))) {
  // `discriminator` is why the generator tags its unions: ajv then reports the
  // branch the sender meant instead of every branch it did not.
  const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(schema, 'ahp');

  const validators = new Map();
  const skipped = new Map();
  let checked = 0;

  const against = (def, value, sample, into) => {
    if (def === undefined || !schema.$defs[def]) {
      const name = def ?? String(sample);
      skipped.set(name, (skipped.get(name) ?? 0) + 1);
      return;
    }
    if (!validators.has(def)) validators.set(def, ajv.compile({ $ref: `ahp#/$defs/${def}` }));
    const validate = validators.get(def);
    checked += 1;
    if (validate(value)) return;
    for (const error of narrow(validate.errors ?? [])) {
      into.push({
        def,
        at: (error.instancePath || '/').replace(/\/\d+/g, '/N'),
        what: error.keyword === 'additionalProperties'
          ? `undeclared key \`${error.params.additionalProperty}\``
          : error.keyword === 'required'
            ? `missing required \`${error.params.missingProperty}\``
            : `${error.keyword} ${error.message}`,
        sample,
      });
    }
  };

  return {
    declarations: Object.keys(schema.$defs).length,
    checked: () => checked,
    skipped: () => new Map(skipped),
    frame(value) {
      const found = [];
      if (typeof value !== 'object' || value === null) return found;
      // A subscribe answer: the snapshot names its own channel.
      const snapshot = value.result?.snapshot;
      if (snapshot?.state !== undefined) against(stateFor(snapshot.resource), snapshot.state, snapshot.resource, found);
      // A reconnect answer carries several at once.
      for (const one of value.result?.snapshots ?? []) {
        if (one?.state !== undefined) against(stateFor(one.resource), one.state, one.resource, found);
      }
      /*
       * A resolved config schema.
       *
       * The whole result, not the schema alone: `ResolveSessionConfigResult`
       * declares both halves, and the echoed values are as much a payload as
       * the questions they answer. Picking the schema out and guessing its
       * type reported `sessionMutable` as undeclared - it is declared, on the
       * *session* config schema, which is not the generic one.
       */
      if (value.result?.schema !== undefined && snapshot === undefined) {
        against('ResolveSessionConfigResult', value.result, 'resolveSessionConfig', found);
      }
      // An action, envelope and payload both. The payload's declaration is
      // named after its action type, which the package spells in PascalCase
      // with the channel prefix - `chat/delta` is `ChatDeltaAction`.
      if (value.method === 'action' && value.params) {
        against('ActionEnvelope', value.params, value.params.channel, found);
        const type = value.params.action?.type;
        if (typeof type === 'string') against(actionDef(type), value.params.action, type, found);
      }
      return found;
    },
  };
}

/** One line per defect, with a count, out of however many frames produced it. */
export function collapse(defects) {
  const found = new Map();
  for (const one of defects) {
    const key = `${one.def} ${one.at} ${one.what}`;
    const entry = found.get(key) ?? { count: 0, sample: one.sample };
    entry.count += 1;
    found.set(key, entry);
  }
  return [...found].sort(([, a], [, b]) => b.count - a.count);
}

/**
 * Frames out of a capture.
 *
 * JSON lines. Each line is either a protocol frame or an object with the
 * frame under `frame`, as a string or an object - which is what the recorders
 * on both sides of this protocol happen to write.
 */
export function* framesIn(text) {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let held;
    try { held = JSON.parse(line); } catch { continue; }
    let frame = held?.frame ?? held;
    if (typeof frame === 'string') {
      try { frame = JSON.parse(frame); } catch { continue; }
    }
    if (typeof frame === 'object' && frame !== null) yield frame;
  }
}
