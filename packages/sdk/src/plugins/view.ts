/**
 * The check a view passes before the host keeps it.
 *
 * A view is a plugin's own object, and the daemon cannot know it is one a
 * client can draw. So this is the boundary: the surface must be one a client
 * has, every component must be one of the kinds a client is promised, every
 * reference must name a component, and nothing may be a binding this host does
 * not send yet. The refusal names the rule, so an author reads what to change.
 *
 * `literalOf` is the one place that changes when bindings arrive: today every
 * prop is a literal value, and `{ path }` is refused with the reason.
 */

import type { ServedMethod, ViewComponent } from '../types/plugin.js';
import { isWebUrl } from '../weburl.js';

/** The component kinds a view may hold: a small set each client can draw. */
export const VIEW_KINDS: readonly string[] = ['Text', 'Link', 'Button', 'Card', 'Row', 'Column', 'List', 'Divider', 'Icon'];

/** The members that say what a component is rather than what it draws. */
const STRUCTURE = new Set(['id', 'component', 'child', 'children', 'action']);

/** The most components one view may hold, which is a page of state rather than a document. */
export const MAX_COMPONENTS = 200;

/** The most JSON one view may hold, in bytes. */
export const MAX_VIEW_BYTES = 64 * 1024;

/** The value as one object, or `undefined` for anything else. Arrays and `null` are not objects. */
const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/**
 * Refuse a prop that is a binding, for now.
 *
 * A view carries literal values only: a plugin sends the whole view again on
 * each change, and `{ path }` is the A2UI way to read a prop from a data model
 * this host does not send yet. Bindings come in a later plan, and this is the
 * one function that changes when they do.
 */
export const literalOf = (value: unknown): void => {
  if (asObject(value) !== undefined && Object.hasOwn(value as object, 'path')) {
    throw new Error('a view prop may not be a { path } binding: bindings come in a later plan');
  }
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
  const fail: (rule: string) => never = (rule) => {
    throw new Error(`plugin ${by}: showView needs ${rule}`);
  };
  if (surface !== 'main') {
    fail('the surface to be main, the one surface a client draws');
  }
  if (asObject(view) === undefined) fail('the view to be an object');
  const held = view as Record<string, unknown>;
  let json: string;
  try {
    json = JSON.stringify(view);
  }
  catch {
    return fail('the view to be JSON');
  }
  if (new TextEncoder().encode(json).length > MAX_VIEW_BYTES) {
    fail(`the view to be at most ${String(MAX_VIEW_BYTES)} bytes of JSON`);
  }
  const root = held.root;
  if (typeof root !== 'string' || root === '') {
    fail('root to be the id of a component');
  }
  const components = asObject(held.components);
  if (components === undefined) fail('components to be a map of components by id');
  const entries = Object.entries(components);
  if (entries.length > MAX_COMPONENTS) {
    fail(`the view to be at most ${String(MAX_COMPONENTS)} components`);
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
  if (!Object.hasOwn(components as object, root as string)) {
    fail(`root to name a component, and ${String(root)} is not one`);
  }
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
    if (children !== undefined) {
      if (!Array.isArray(children)) fail(`the children of the component ${key} to be a list of component ids`);
      for (const one of children as unknown[]) named(one, components, key, 'children', fail);
    }
    for (const [prop, propValue] of Object.entries(component)) {
      if (STRUCTURE.has(prop)) continue;
      literalOf(propValue);
    }
    if (component.component === 'Link' && !isWebUrl(component.href)) {
      fail(`the Link ${key} to have href as an absolute http(s) URL with a host`);
    }
    if (component.action !== undefined) checkAction(component.action, key, methods, fail);
  }
  /*
   * A view is a tree: every component below root has one parent, and no path
   * leads back to a component it already passed. A component two parents name
   * could be drawn twice with different state, and a cycle has no first thing
   * to draw.
   */
  const walked = new Map<string, 'open' | 'done'>();
  const walk = (id: string): void => {
    const seen = walked.get(id);
    if (seen === 'open') fail('the components below root to be a tree without a cycle');
    if (seen === 'done') fail(`the component ${id} to have one parent`);
    walked.set(id, 'open');
    const component = components[id] as Record<string, unknown>;
    const child = component['child'];
    if (typeof child === 'string') walk(child);
    const children = component['children'];
    if (Array.isArray(children)) for (const one of children as string[]) walk(one);
    walked.set(id, 'done');
  };
  walk(root as string);
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
