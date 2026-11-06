/**
 * The checks a component tree passes before the host keeps it.
 *
 * A view is a plugin's own object, and the daemon cannot know it is one a
 * client can draw. So this is the boundary: the surface must be one a client
 * has, every component must be one of the kinds a client is promised, every
 * reference must name a component, and the tree must be one. The refusal names
 * the rule, so an author reads what to change.
 *
 * A prop is a literal or `{ path }`, read from the view's `dataModel`, and a
 * list may repeat one component over the items at a path. The same check runs
 * for a plugin's page and for a connector's or an agent's view.
 */

import type { ServedMethod, ViewComponent, ViewSurface } from '../types/plugin.js';
import { isWebUrl } from '../weburl.js';

/** The surfaces a view may be shown on, for a plugin's page and for a record alike. */
export const VIEW_SURFACES: readonly ViewSurface[] = ['main'];

/**
 * The component kinds a view may hold: a small set each client can draw.
 *
 * `Progress` is a bar: `value` out of `max`, 100 when absent, with an optional
 * `label` and `display`. `DateTime` is a time a client shows in its reader's
 * own zone: `value` is an ISO time, and `format` is one of `DATE_TIME_FORMATS`.
 */
export const VIEW_KINDS: readonly string[] = ['Text', 'Link', 'Button', 'Card', 'Row', 'Column', 'List', 'Divider', 'Icon', 'Progress', 'DateTime'];

/**
 * How a `DateTime` shows its time: the hour, the day, both, or `auto`, which is
 * the hour on the reader's today and the weekday, the day and the hour on any
 * other day. `auto` is the default.
 */
export const DATE_TIME_FORMATS: readonly string[] = ['time', 'date', 'datetime', 'auto'];

/** The members that say what a component is rather than what it draws. */
const STRUCTURE = new Set(['id', 'component', 'child', 'children', 'action']);

/** The most components one view may hold, which is a page of state rather than a document. */
export const MAX_COMPONENTS = 200;

/** The most JSON one view may hold, in bytes. */
export const MAX_VIEW_BYTES = 64 * 1024;

/** The value as one object, or `undefined` for anything else. Arrays and `null` are not objects. */
const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** What a refusal is called through: it always throws, so a failed read stops there. */
type Fail = (rule: string) => never;

/**
 * A prop bound to the data model, as `{ path }`, or `undefined` for a literal.
 *
 * Only the presence of the member is read here. Whether the binding is one a
 * renderer can follow is `checkProp`'s to say.
 */
const bindingOf = (value: unknown): Record<string, unknown> | undefined => {
  const held = asObject(value);
  return held !== undefined && Object.hasOwn(held, 'path') ? held : undefined;
};

/**
 * The part every component tree shares, checked once.
 *
 * It is JSON within the limits, `root` names a component, and every component
 * is one of the kinds with the id it is held under. The entries come back for
 * the caller's own read of each component, which is where a view and a ui
 * schema part.
 */
const treeOf = (
  tree: unknown,
  what: string,
  fail: Fail,
): { components: Record<string, unknown>; entries: [string, unknown][] } => {
  if (asObject(tree) === undefined) fail(`${what} to be an object`);
  const held = tree as Record<string, unknown>;
  let json: string;
  try {
    json = JSON.stringify(tree);
  }
  catch {
    return fail(`${what} to be JSON`);
  }
  if (new TextEncoder().encode(json).length > MAX_VIEW_BYTES) {
    fail(`${what} to be at most ${String(MAX_VIEW_BYTES)} bytes of JSON`);
  }
  const root = held.root;
  if (typeof root !== 'string' || root === '') {
    fail('root to be the id of a component');
  }
  const components = asObject(held.components);
  if (components === undefined) fail('components to be a map of components by id');
  const entries = Object.entries(components);
  if (entries.length > MAX_COMPONENTS) {
    fail(`${what} to be at most ${String(MAX_COMPONENTS)} components`);
  }
  for (const [key, value] of entries) {
    const component = asObject(value);
    if (component === undefined) fail(`the component ${key} to be an object`);
    if (component.id !== key) fail(`the component ${key} to have the id ${key}`);
    const kind = component.component;
    if (typeof kind !== 'string' || !VIEW_KINDS.includes(kind)) {
      fail(`the component ${key} to be one of ${VIEW_KINDS.join(', ')}`);
    }
  }
  if (!Object.hasOwn(components, root as string)) {
    fail(`root to name a component, and ${String(root)} is not one`);
  }
  return { components, entries };
};

/**
 * Walk the tree from `root`.
 *
 * Every component below root has one parent, and no path leads back to a
 * component it already passed. A component two parents name could be drawn
 * twice with different state, and a cycle has no first thing to draw.
 *
 * `below` answers the components one component names under it, which each
 * caller reads from the members its own shape allows.
 */
const walkTree = (root: string, below: (id: string) => string[], fail: Fail): void => {
  const walked = new Map<string, 'open' | 'done'>();
  const walk = (id: string): void => {
    const seen = walked.get(id);
    if (seen === 'open') fail('the components below root to be a tree without a cycle');
    if (seen === 'done') fail(`the component ${id} to have one parent`);
    walked.set(id, 'open');
    for (const child of below(id)) walk(child);
    walked.set(id, 'done');
  };
  walk(root);
};

/**
 * The components one component names under it, as the walk reads them.
 *
 * `children` is a list in a view and a list or `{ path, componentId }` in a ui
 * schema. A reference that is not a string was refused before the walk, so only
 * the strings are read here.
 */
const belowOf = (component: Record<string, unknown>): string[] => {
  const below: string[] = [];
  if (typeof component['child'] === 'string') below.push(component['child']);
  const children = component['children'];
  if (Array.isArray(children)) {
    for (const one of children as unknown[]) if (typeof one === 'string') below.push(one);
  }
  else {
    const repeated = asObject(children)?.['componentId'];
    if (typeof repeated === 'string') below.push(repeated);
  }
  return below;
};

/**
 * Check one view against the rules a client draws by.
 *
 * `by` is the plugin that sent it, `surface` is where it is drawn and
 * `methods` is what the plugin registered, which a Button's event must name.
 * Everything the check refuses names the rule it broke.
 */
export const checkView = (
  view: unknown,
  surface: string,
  by: string,
  methods: Record<string, ServedMethod>,
): void => {
  const fail: Fail = (rule) => {
    throw new Error(`plugin ${by}: showView needs ${rule}`);
  };
  if (!(VIEW_SURFACES as readonly string[]).includes(surface)) {
    fail(`the surface to be one a client draws: ${VIEW_SURFACES.join(', ')}`);
  }
  const { components, entries } = treeOf(view, 'the view', fail);
  /*
   * Every component's own part: the references it makes, the props it draws,
   * the Link it may be and the action a Button may carry. Read before the walk
   * so a broken reference is refused as that rather than as a missing child.
   */
  for (const [key, value] of entries) {
    const component = value as ViewComponent & Record<string, unknown>;
    const child = component.child;
    if (child !== undefined) named(child, components, key, 'child', fail);
    const children = component.children;
    if (children !== undefined) checkChildren(children, key, components, fail);
    for (const [prop, propValue] of Object.entries(component)) {
      if (STRUCTURE.has(prop)) continue;
      checkProp(propValue, fail);
    }
    if (component.component === 'Link' && bindingOf(component.href) === undefined && !isWebUrl(component.href)) {
      fail(`the Link ${key} to have href as an absolute http(s) URL with a host, or a { path } binding`);
    }
    if (component.action !== undefined) checkAction(component.action, key, methods, fail);
    checkKindProps(component, key, fail);
  }
  const dataModel = (view as Record<string, unknown>).dataModel;
  if (dataModel !== undefined && asObject(dataModel) === undefined) fail('the dataModel to be a JSON object');
  walkTree((view as Record<string, unknown>).root as string, (id) => belowOf(components[id] as Record<string, unknown>), fail);
};

/**
 * Refuse a literal prop a `Progress` or a `DateTime` cannot draw.
 *
 * A bound prop is read from the data, which the check cannot see, so only a
 * literal is checked: a bar's `value` and `max` are numbers, and a time's
 * `value` is an ISO time and its `format` one of `DATE_TIME_FORMATS`.
 */
const checkKindProps = (component: Record<string, unknown>, key: string, fail: Fail): void => {
  const literal = (prop: string): unknown => (bindingOf(component[prop]) === undefined ? component[prop] : undefined);
  if (component['component'] === 'Progress') {
    for (const prop of ['value', 'max']) {
      const held = literal(prop);
      if (held !== undefined && (typeof held !== 'number' || !Number.isFinite(held))) {
        fail(`the ${prop} of the Progress ${key} to be a number or a { path } binding`);
      }
    }
  }
  if (component['component'] === 'DateTime') {
    const value = literal('value');
    if (value !== undefined && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) {
      fail(`the value of the DateTime ${key} to be an ISO time or a { path } binding`);
    }
    const format = literal('format');
    if (format !== undefined && (typeof format !== 'string' || !DATE_TIME_FORMATS.includes(format))) {
      fail(`the format of the DateTime ${key} to be one of ${DATE_TIME_FORMATS.join(', ')}`);
    }
  }
};

/**
 * Refuse a prop that is neither a literal nor `{ path }`.
 *
 * `{ path }` is one path of the view's data model, and nothing else: an object
 * carrying a second member, or no path at all, is a binding no renderer reads.
 */
const checkProp = (value: unknown, fail: Fail): void => {
  const held = bindingOf(value);
  if (held === undefined) return;
  if (Object.keys(held).length !== 1 || typeof held['path'] !== 'string' || held['path'] === '') {
    fail('a prop to be a literal or { path }, one path of the data');
  }
};

/**
 * Check a component's `children`: a list of ids, or one repeated over a list.
 *
 * `{ path, componentId }` draws `componentId` once for each item at `path`, and
 * the component it names is walked as a child, so the tree rule holds over the
 * component a list repeats.
 */
const checkChildren = (
  children: unknown,
  key: string,
  components: Record<string, unknown>,
  fail: Fail,
): void => {
  if (Array.isArray(children)) {
    for (const one of children as unknown[]) named(one, components, key, 'children', fail);
    return;
  }
  const held = asObject(children);
  if (
    held === undefined
    || Object.keys(held).length !== 2
    || typeof held['path'] !== 'string' || held['path'] === ''
    || typeof held['componentId'] !== 'string'
  ) {
    fail(`the children of the component ${key} to be a list of component ids or { path, componentId }`);
  }
  named(held['componentId'], components, key, 'children binding', fail);
};

/** Refuse one reference that names no component, naming the member and the name. */
const named = (
  value: unknown,
  components: Record<string, unknown>,
  key: string,
  member: string,
  fail: (rule: string) => never,
): void => {
  if (typeof value !== 'string' || !Object.hasOwn(components, value)) {
    fail(`the ${member} of the component ${key} to name a component, and ${String(value)} is not one`);
  }
};

/**
 * Refuse an action that is not a call to one of this plugin's own methods.
 *
 * A Button sends a normal request, and the host checks the method's grant, so
 * the name has to be a method the plugin registered. `context` is the request's
 * params, and it is a plain object or nothing at all.
 */
const checkAction = (
  action: unknown,
  key: string,
  methods: Record<string, ServedMethod>,
  fail: (rule: string) => never,
): void => {
  const held = asObject(action);
  if (held === undefined) {
    fail(`the action of the component ${key} to be { event: { name, context? } }`);
  }
  const event = asObject(held.event);
  if (event === undefined || typeof event.name !== 'string') {
    fail(`the action of the component ${key} to be { event: { name, context? } }`);
  }
  const name = event.name;
  if (!Object.hasOwn(methods, name)) {
    fail(`the action of the component ${key} to name an x- method this plugin registered, and ${name} is not one`);
  }
  const context = event.context;
  if (context !== undefined && asObject(context) === undefined) {
    fail(`the context of the component ${key} to be a JSON object`);
  }
};
