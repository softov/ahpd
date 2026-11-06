/**
 * The views of open records, by record and surface, and the handle that
 * changes them.
 *
 * A connector and an agent show views the way a plugin shows one on its page:
 * `showView`, `setViewData` and `clearView`, each on a surface. The plugin
 * makes the calls through a `ViewHandle` that `open` hands it, and the handle
 * names one opening of one record. A record opened again gets a new handle, and
 * the old one writes nothing, so a late answer cannot bring a view back.
 *
 * `withViewData` is the one way a value is set in a view's data model, for a
 * record here and for a plugin's page in the server.
 */

import { reason } from '../utils/values.js';
import { checkView, MAX_VIEW_BYTES } from './view.js';
import type { PluginView, ServedMethod, ViewHandle, ViewSurface } from '../types/plugin.js';

/** `/`, or one or more `/`-led segments with no empty one: `/plan`, `/windows/0/left`. */
const PATH = /^\/$|^(?:\/[^/]+)+$/;

/** The value as one object, or `undefined` for anything else. Arrays and `null` are not objects. */
const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/**
 * A copy of `view` with `value` set at `path` of its data model.
 *
 * `/` replaces the whole model, and `value` must then be an object. Another
 * path walks the model one segment at a time and makes an object where a
 * segment is missing; a segment on a list is an index in it. `value` must be
 * JSON, and the view with its new model must stay within 64 KiB of JSON. A
 * refusal throws, naming the rule it broke, and `view` is not changed.
 */
export const withViewData = (view: PluginView, path: string, value: unknown): PluginView => {
  if (typeof path !== 'string' || !PATH.test(path)) {
    throw new Error(`the path to be / or /a/b, and ${String(path)} is not one`);
  }
  let copied: unknown;
  try {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error('not JSON');
    copied = JSON.parse(json);
  }
  catch {
    throw new Error(`the value at ${path} to be JSON`);
  }
  const next = structuredClone(view);
  if (path === '/') {
    const model = asObject(copied);
    if (model === undefined) throw new Error('the value at / to be a JSON object, the whole data model');
    next.dataModel = model;
  }
  else {
    const segments = path.slice(1).split('/');
    const last = segments.pop() as string;
    let at: unknown = next.dataModel ??= {};
    for (const segment of segments) {
      const holder = at as Record<string, unknown>;
      const below = holder[segment];
      if (typeof below !== 'object' || below === null) holder[segment] = {};
      at = holder[segment];
    }
    if (Array.isArray(at)) {
      const index = Number(last);
      if (!Number.isInteger(index) || index < 0 || index > at.length) {
        throw new Error(`the segment ${last} of ${path} to be an index of its list`);
      }
      at[index] = copied;
    }
    else {
      (at as Record<string, unknown>)[last] = copied;
    }
  }
  if (new TextEncoder().encode(JSON.stringify(next)).length > MAX_VIEW_BYTES) {
    throw new Error(`the view with its data to be at most ${String(MAX_VIEW_BYTES)} bytes of JSON`);
  }
  return next;
};

/** One opening of one record, as its handle is made for it. */
export interface ViewOpening {
  /** The record's id. */
  id: string;
  /** The adapter or engine it was opened from, so an unloaded plugin's views go. */
  from: string;
  /** The plugin that registered that adapter or engine, which a refusal names. */
  by: string;
  /** The surfaces its `view` capabilities name: a view on another is refused. */
  surfaces: readonly string[];
  /** The methods that plugin registered, which a Button's event must name. */
  methods: Record<string, ServedMethod>;
}

/** What the holder tells its channel. */
export interface RecordViewsOptions {
  /** Where a refused call is said. */
  problem(message: string): void;
  /** A record's views changed whole, so its row goes out again. */
  changed(id: string): void;
  /** One value of a record's view data changed, which its readers get alone. */
  data(id: string, surface: ViewSurface, path: string, value: unknown): void;
}

/** The views of the open records of one channel. */
export interface RecordViews {
  /** A handle for a new opening of a record, which replaces the views of any earlier one. */
  open(opening: ViewOpening): ViewHandle;
  /** One record's views by surface, or nothing when it shows none. */
  of(id: string): Record<string, PluginView> | undefined;
  /** Forget one record's views: it closed, failed to open, or was removed. */
  drop(id: string): void;
  /** Forget the views of every record whose adapter or engine `served` no longer answers for. */
  dropUnless(served: (from: string) => boolean): void;
}

/** One record's views, as one opening made them. */
interface Held {
  opening: ViewOpening;
  views: Record<string, PluginView>;
}

export function recordViews(options: RecordViewsOptions): RecordViews {
  const held = new Map<string, Held>();

  const open = (opening: ViewOpening): ViewHandle => {
    const entry: Held = { opening, views: {} };
    held.set(opening.id, entry);
    const { id } = opening;
    /** Whether this handle's opening is still the record's own. */
    const live = (): boolean => held.get(id) === entry;
    /** Whether a call may draw on this surface, saying why when it may not. */
    const declared = (surface: string, call: string): boolean => {
      if (opening.surfaces.includes(surface)) return true;
      options.problem(`${id}: ${call} on ${surface}, a surface no view capability of ${opening.from} names`);
      return false;
    };
    return {
      showView: (view, surface = 'main') => {
        if (!live() || !declared(surface, 'showView')) return;
        let kept: PluginView;
        try {
          // A copy, so the view kept is the one checked, whatever the plugin does to its own object later.
          kept = structuredClone(view);
          checkView(kept, surface, opening.by, opening.methods);
        }
        catch (error) {
          options.problem(`${id}'s view was not kept: ${reason(error)}`);
          return;
        }
        entry.views[surface] = kept;
        options.changed(id);
      },
      setViewData: (path, value, surface = 'main') => {
        if (!live() || !declared(surface, 'setViewData')) return;
        const view = entry.views[surface];
        if (view === undefined) {
          options.problem(`${id}: setViewData on ${surface}, which shows no view`);
          return;
        }
        let next: PluginView;
        try {
          next = withViewData(view, path, value);
        }
        catch (error) {
          options.problem(`${id}'s view data was not set: setViewData needs ${reason(error)}`);
          return;
        }
        entry.views[surface] = next;
        options.data(id, surface, path, viewDataAt(next, path));
      },
      clearView: (surface = 'main') => {
        if (!live() || !Object.hasOwn(entry.views, surface)) return;
        delete entry.views[surface];
        options.changed(id);
      },
    };
  };

  return {
    open,
    of: (id) => {
      const views = held.get(id)?.views;
      return views === undefined || Object.keys(views).length === 0 ? undefined : views;
    },
    drop: (id) => { held.delete(id); },
    dropUnless: (served) => {
      for (const [id, entry] of held) if (!served(entry.opening.from)) held.delete(id);
    },
  };
}

/** The value at `path` of a view's data model, as `withViewData` set it; `/` is the whole model. */
export const viewDataAt = (view: PluginView, path: string): unknown => {
  let at: unknown = view.dataModel;
  if (path === '/') return at;
  for (const segment of path.slice(1).split('/')) {
    at = Array.isArray(at) ? at[Number(segment)] : asObject(at)?.[segment];
  }
  return at;
};
