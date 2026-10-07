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
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Ajv = require('ajv/dist/2020.js').default ?? require('ajv/dist/2020.js');
const addFormats = require('ajv-formats').default ?? require('ajv-formats');

/** Where `schema.mjs` writes, which is where this reads. */
export const SCHEMA = new URL('./ahp.strict.schema.json', import.meta.url);

/*
 * The protocol package's own version, as installed. The manifest is found by
 * walking up out of `tools/` rather than through the package's `exports`, which
 * names no subpath for it, and `import.meta.resolve`, which is not there at all
 * when this module is run by the test bundler rather than by node.
 */
const installed = (() => {
  for (let dir = path.dirname(fileURLToPath(import.meta.url)); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const at = path.join(dir, 'node_modules', '@microsoft', 'agent-host-protocol', 'package.json');
    if (existsSync(at)) return require(at).version;
  }
  return undefined;
})();

/**
 * Whether the schema on disk was built from a package other than the one
 * installed, or is not there at all.
 *
 * `schema.mjs` stamps the version it read its declarations out of, and this
 * is what reads it back. A bare `vitest run` used to rebuild the file only
 * when it was missing, so after a package bump it went on checking frames
 * against the protocol of the version before, and said nothing: it had no
 * way to know, and a check made against the wrong protocol is a check that
 * passes for the wrong reason.
 */
export function stale(at = SCHEMA) {
  let written;
  try {
    written = JSON.parse(readFileSync(at, 'utf8')).ahpVersion;
  } catch {
    return true;
  }
  return written !== installed;
}

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

/** A JSON Pointer step, where a method name carries a slash of its own. */
const step = (part) => part.replace(/~/gu, '~0').replace(/\//gu, '~1');

/**
 * A checker over one strict schema.
 *
 * `frame(value)` takes one protocol frame and answers the defects in it:
 * `{ def, at, what, sample }` each, where `at` has array indices folded to
 * `N` so one bad conversation is one finding rather than hundreds. `skipped`
 * counts the payloads nothing here knows how to route, which is the part of
 * the surface this is *not* checking and says so.
 *
 * A frame is routed by what the protocol says it is, never by its name:
 * a recorded exchange - `{ asked, params, result }` - goes through
 * `CommandMap`, whose entry names the params declaration and the result one,
 * and a notification through `ServerNotificationMap`. Routing by name instead
 * would check a payload against whatever definition happened to be called
 * after it, which is how a session summary came to be checked as a chat.
 */
export function checker(schema = JSON.parse(readFileSync(SCHEMA, 'utf8'))) {
  // `discriminator` is why the generator tags its unions: ajv then reports the
  // branch the sender meant instead of every branch it did not.
  const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true, discriminator: true });
  addFormats(ajv);
  ajv.addSchema(schema, 'ahp');

  /*
   * The same declarations, with a snapshot's `state` open.
   *
   * `Snapshot.state` is a union of ten channel states and carries no tag, so
   * a validator asked for one branch answers with the nine that are not - the
   * union working correctly, and nothing a reader can act on. Which channel a
   * snapshot is, is a fact of its resource, and `stateFor` is the only thing
   * here that knows it; so the state is checked from there and the rest of
   * the snapshot is checked with the key opened, where `resource`, `fromSeq`
   * and an invented key are all still findings.
   */
  const snapshot = schema.$defs.Snapshot;
  const open = snapshot === undefined ? undefined : {
    ...schema,
    $id: 'ahp-open',
    $defs: {
      ...schema.$defs,
      Snapshot: {
        ...snapshot,
        properties: { ...snapshot.properties, state: true },
        required: (snapshot.required ?? []).filter((one) => one !== 'state'),
      },
    },
  };
  if (open !== undefined) ajv.addSchema(open, 'ahp-open');
  // A result may carry a snapshot, so results are checked where the state is
  // open; params and notifications never do.
  const results = open === undefined ? 'ahp' : 'ahp-open';

  /*
   * The protocol's own index of who sends what.
   *
   * A request travels one way or the other and each direction has a map of its
   * own, and a notification likewise - so a method's declaration is read off
   * the method rather than guessed from the shape of the frame. Which map holds
   * one is what `holder` answers; a method in none of them is not routed.
   */
  const REQUESTS = ['CommandMap', 'ServerCommandMap'];
  const NOTIFICATIONS = ['ServerNotificationMap', 'ClientNotificationMap'];
  const holder = (names, method) => names.find((name) => {
    const properties = schema.$defs[name]?.properties;
    return properties !== undefined && Object.hasOwn(properties, method);
  });

  const validators = new Map();
  const skipped = new Map();
  let checked = 0;

  const skip = (name) => skipped.set(name, (skipped.get(name) ?? 0) + 1);

  /** What a finding is reported under: the definition, or where it stands. */
  const labelFor = (where, which, shape) => (typeof shape?.$ref === 'string'
    ? shape.$ref.split('/').pop()
    : `${where}.${which}`);

  const run = (ref, label, value, sample, into) => {
    if (!validators.has(ref)) validators.set(ref, ajv.compile({ $ref: ref }));
    const validate = validators.get(ref);
    checked += 1;
    if (validate(value)) return;
    for (const error of narrow(validate.errors ?? [])) {
      into.push({
        def: label,
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

  /** One named definition, where a frame names one rather than a map entry. */
  const against = (def, value, sample, into) => {
    if (def === undefined || schema.$defs[def] === undefined) {
      skip(def ?? String(sample));
      return;
    }
    run(`ahp#/$defs/${def}`, def, value, sample, into);
  };

  /** One half of a map entry - a command's params or its result, or a notification's params. */
  const half = (at, map, method, which, value, sample, into) => {
    const shape = schema.$defs[map]?.properties?.[method]?.properties?.[which];
    if (shape === undefined) return;
    run(`${at}#/$defs/${map}/properties/${step(method)}/properties/${which}`,
      labelFor(map, `${method}.${which}`, shape), value, sample, into);
  };

  /**
   * A snapshot's own state, from the resource it names.
   *
   * The one thing the schema cannot say, because the union carries no tag: a
   * subscribe answer's snapshot and every snapshot a reconnect or an
   * initialize carries are checked here, and the rest of the frame by the map.
   */
  const states = (result, into) => {
    if (result === null || typeof result !== 'object') return;
    const each = (one) => {
      if (one?.state !== undefined) against(stateFor(one.resource), one.state, one.resource, into);
    };
    each(result.snapshot);
    for (const one of result.snapshots ?? []) each(one);
  };

  return {
    declarations: Object.keys(schema.$defs).length,
    checked: () => checked,
    skipped: () => new Map(skipped),
    frame(value) {
      const found = [];
      if (typeof value !== 'object' || value === null) return found;
      /*
       * A capture from `--wire` carries `_ahpLog` beside the message: the
       * log's own meta, which no declaration has and the closed objects here
       * would report as undeclared. It is the recorder's, not the protocol's,
       * so it comes off before anything is checked.
       */
      const { _ahpLog, ...message } = value;
      void _ahpLog;

      if (typeof message.asked === 'string') {
        // A recorded exchange: the request one side sent and the answer back.
        const map = holder(REQUESTS, message.asked);
        if (map === undefined) {
          skip(message.asked);
        } else {
          const ask = message.params?.channel ?? message.asked;
          if (message.params !== undefined) half('ahp', map, message.asked, 'params', message.params, ask, found);
          // A refusal has no result to check; its params are still the request's.
          if (message.error === undefined && Object.hasOwn(message, 'result')) {
            half(results, map, message.asked, 'result', message.result, message.asked, found);
            states(message.result, found);
          }
        }
      } else if (typeof message.method === 'string') {
        const map = holder(NOTIFICATIONS, message.method);
        if (map === undefined) skip(message.method);
        else half('ahp', map, message.method, 'params', message.params, message.params?.channel ?? message.method, found);

        /*
         * An action's payload, under the envelope that carried it.
         *
         * The envelope is checked by the map, and the payload by the
         * declaration its type names - the package spells it in PascalCase with
         * the channel prefix, so `chat/delta` is `ChatDeltaAction`. A `$ref`
         * names the envelope and not the branch inside it, so a finding in the
         * payload would otherwise be reported against the union as a whole.
         */
        if (message.method === 'action' && message.params !== null && typeof message.params === 'object') {
          const type = message.params.action?.type;
          if (typeof type === 'string') against(actionDef(type), message.params.action, type, found);
        }
      } else if (message.result !== null && typeof message.result === 'object' && message.result !== undefined) {
        /*
         * An answer whose request is not in this capture.
         *
         * `validate.mjs` pairs a request with its answer, and the suite records
         * the pair; a recording taken mid-flight, or one whose request line was
         * dropped, still has a result in it, and both halves are worth checking
         * whether or not the method that asked is on hand.
         */
        states(message.result, found);
        /*
         * A resolved config schema. The whole result, not the schema alone:
         * `ResolveSessionConfigResult` declares both halves, and the echoed
         * values are as much a payload as the questions they answer.
         */
        if (message.result.schema !== undefined) {
          against('ResolveSessionConfigResult', message.result, 'resolveSessionConfig', found);
        }
      }
      return found;
    },
  };
}

/**
 * Every `_meta` key in a frame, with the path the object sits at.
 *
 * `_meta` is the protocol's one open bag: any key may go in it, nothing is
 * declared, and a closed-object schema has no opinion about what is there. So
 * it is where a host invents names, and where those names are invisible to
 * every other check in this file.
 *
 * The key is reported with the path rather than on its own because the same
 * key means different things in different places: `command` is the reference
 * client's on a completion item and an invention on anything else, so a census
 * that reported bare names could not tell the two apart and would have to
 * allow the name everywhere.
 *
 * Array indices are folded the way the checker folds them, so one bad list is
 * one entry rather than one per element.
 */
export function metaKeys(frame) {
  const found = [];
  const walk = (value, at) => {
    if (Array.isArray(value)) {
      value.forEach((one, index) => walk(one, `${at}/${index}`));
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    for (const [key, held] of Object.entries(value)) {
      const here = `${at}/${step(key)}`;
      if (key === '_meta' && typeof held === 'object' && held !== null) {
        for (const one of Object.keys(held)) {
          found.push({ key: one, at: here.replace(/\/\d+/gu, '/N') });
        }
      }
      walk(held, here);
    }
  };
  walk(frame, '');
  return found;
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
 * JSON lines. Each line is either a protocol frame - which is what `--wire`
 * writes, the message with `_ahpLog` beside it - or an object with the frame
 * under `frame`, as a string or an object, which is what the recorders on both
 * sides of this protocol happened to write. Both are read, so a capture taken
 * before the shape changed still checks.
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
