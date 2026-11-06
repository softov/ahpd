import { describe, expect, it } from 'vitest';
import { createCanvases } from '../src/host/canvases.js';
import { pluginHost } from '../src/plugins/plugins.js';
import { checkView, MAX_COMPONENTS } from '../src/plugins/view.js';
import { sdkVersion } from '../src/version.js';
import { isWebUrl } from '../src/weburl.js';
import type { HostRecordingOptions } from '../src/plugins/plugins.js';
import type { LoaderContext, PluginView, ServedMethod } from '../src/types/plugin.js';

/*
 * A view a plugin gives, and the check that keeps a client able to draw it.
 *
 * The check is called here the way the plugin host calls it, so a case reads
 * the sentence an author would read. The canvas case is the other caller of
 * the shared URL rule, which is why it is here: one function, two callers.
 */

const DIR = '/tmp/plugin-view';

const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: () => {}, say: () => {},
});

/** A view every client can draw: a Card, a Column, a Text, a Link and a Button. */
const GOOD: PluginView = {
  root: 'card',
  components: {
    card: { id: 'card', component: 'Card', child: 'body' },
    body: { id: 'body', component: 'Column', children: ['title', 'open', 'go'] },
    title: { id: 'title', component: 'Text', text: 'Ready' },
    open: { id: 'open', component: 'Link', label: 'Open', href: 'https://example.test/x' },
    go: { id: 'go', component: 'Button', label: 'Go', action: { event: { name: 'x-view/go' } } },
  },
};

/** What one call refused with, or a failure saying it was not refused. */
const refused = (call: () => unknown): string => {
  try {
    call();
  }
  catch (error) {
    return (error as Error).message;
  }
  throw new Error('the call was not refused');
};

/** A plugin host that registered the method GOOD's Button calls. */
const made = (sinks: HostRecordingOptions = {}) => {
  const { host } = pluginHost('board', context(), sinks);
  host.registerMethod('x-view/go', { grant: 'demo:read', handle: () => ({}) });
  return host;
};

/** The message a view refused with, through the plugin host. */
const denied = (view: unknown, surface?: string): string =>
  refused(() => { made().showView(view as PluginView, surface as never); });

describe('a view a client can draw', () => {
  it('reaches the loader\'s sinks with the surface main, and a clear does too', () => {
    const shown: [string, PluginView][] = [];
    const cleared: string[] = [];
    const host = made({
      showView: (surface, view) => { shown.push([surface, view]); },
      clearView: (surface) => { cleared.push(surface); },
    });
    host.showView(GOOD);
    host.clearView();
    expect(shown).toEqual([['main', GOOD]]);
    expect(cleared).toEqual(['main']);
  });

  it('sends a setViewData to the loader\'s sink, with main when the call names no surface', () => {
    const set: [string, string, unknown][] = [];
    const host = made({ setViewData: (surface, path, value) => { set.push([surface, path, value]); } });
    host.setViewData('/plan', 'max');
    expect(set).toEqual([['main', '/plan', 'max']]);
    expect(refused(() => { host.setViewData('/plan', 'max', 'side' as never); }))
      .toBe('plugin board: setViewData needs the surface to be one a client draws: main');
  });

  it('keeps a copy, so a change to the plugin\'s object later is not on the row', () => {
    const shown: PluginView[] = [];
    const view = structuredClone(GOOD);
    made({ showView: (_surface, held) => { shown.push(held); } }).showView(view);
    (view.components['title'] as { text?: string }).text = 'Changed';
    expect(shown[0]).toEqual(GOOD);
  });

  it('refuses a view that is not JSON', () => {
    const view = { ...GOOD, components: { ...GOOD.components, title: { id: 'title', component: 'Text', text: () => 'Ready' } } };
    expect(denied(view)).toBe('plugin board: showView needs the view to be JSON');
  });

  it('uses main when the call names no surface', () => {
    const shown: string[] = [];
    made({ showView: (surface) => { shown.push(surface); } }).showView(GOOD);
    expect(shown).toEqual(['main']);
  });

  it('accepts a view that names a method the plugin registered without a context', () => {
    expect(() => { made().showView(GOOD); }).not.toThrow();
  });

  it('refuses a surface no client draws', () => {
    expect(denied(GOOD, 'side')).toBe('plugin board: showView needs the surface to be one a client draws: main');
  });
});

describe('a view a client cannot draw', () => {
  it('needs a root that names a component', () => {
    expect(denied({ ...GOOD, root: 'nope' }, 'main')).toBe('plugin board: showView needs root to name a component, and nope is not one');
    expect(denied({ ...GOOD, root: '' }, 'main')).toBe('plugin board: showView needs root to be the id of a component');
  });

  it('needs a key that is the component\'s own id', () => {
    const view = { root: 'a', components: { a: { id: 'b', component: 'Text', text: 'x' } } };
    expect(denied(view, 'main')).toBe('plugin board: showView needs the component a to have the id a');
  });

  it('refuses a component name that is not one of the kinds', () => {
    const view = { root: 'a', components: { a: { id: 'a', component: 'Image', src: 'x' } } };
    expect(denied(view, 'main')).toContain('to be one of Text, Link, Button, Card, Row, Column, List, Divider, Icon');
  });

  it('refuses a child or a children entry that names no component', () => {
    const child = { root: 'a', components: { a: { id: 'a', component: 'Card', child: 'nope' } } };
    expect(denied(child, 'main')).toBe('plugin board: showView needs the child of the component a to name a component, and nope is not one');
    const children = { root: 'a', components: { a: { id: 'a', component: 'Column', children: ['nope'] } } };
    expect(denied(children, 'main')).toBe('plugin board: showView needs the children of the component a to name a component, and nope is not one');
  });

  it('refuses a component two parents name', () => {
    const view = {
      root: 'a',
      components: {
        a: { id: 'a', component: 'Column', children: ['b', 'c'] },
        b: { id: 'b', component: 'Card', child: 'd' },
        c: { id: 'c', component: 'Card', child: 'd' },
        d: { id: 'd', component: 'Text', text: 'x' },
      },
    };
    expect(denied(view, 'main')).toBe('plugin board: showView needs the component d to have one parent');
  });

  it('refuses a cycle from root', () => {
    const view = {
      root: 'a',
      components: {
        a: { id: 'a', component: 'Card', child: 'b' },
        b: { id: 'b', component: 'Text', text: 'x', child: 'a' },
      },
    };
    expect(denied(view, 'main')).toBe('plugin board: showView needs the components below root to be a tree without a cycle');
  });

  it('refuses more components than a page of state holds', () => {
    const components: Record<string, unknown> = { root: { id: 'root', component: 'Text', text: 'x' } };
    for (let at = 0; at < MAX_COMPONENTS; at += 1) components[`c${String(at)}`] = { id: `c${String(at)}`, component: 'Text', text: 'x' };
    expect(denied({ root: 'root', components }, 'main')).toBe('plugin board: showView needs the view to be at most 200 components');
  });

  it('refuses more JSON than a page holds', () => {
    const text = 'x'.repeat(64 * 1024);
    expect(denied({ root: 'a', components: { a: { id: 'a', component: 'Text', text } } }, 'main'))
      .toBe('plugin board: showView needs the view to be at most 65536 bytes of JSON');
  });

  it('counts the data model in the JSON a page holds', () => {
    const view = { root: 'a', components: { a: { id: 'a', component: 'Text', text: { path: '/x' } } }, dataModel: { x: 'x'.repeat(64 * 1024) } };
    expect(denied(view, 'main')).toBe('plugin board: showView needs the view to be at most 65536 bytes of JSON');
  });

  it('refuses a data model that is not a JSON object', () => {
    const view = { root: 'a', components: { a: { id: 'a', component: 'Text', text: { path: '/x' } } }, dataModel: ['x'] };
    expect(denied(view, 'main')).toBe('plugin board: showView needs the dataModel to be a JSON object');
  });

  it('refuses a Link whose href is not an absolute http(s) URL', () => {
    const view = { root: 'a', components: { a: { id: 'a', component: 'Link', label: 'x', href: 'board/1' } } };
    expect(denied(view, 'main')).toBe('plugin board: showView needs the Link a to have href as an absolute http(s) URL with a host, or a { path } binding');
  });

  it('refuses an action that is not an event call', () => {
    const view = { root: 'a', components: { a: { id: 'a', component: 'Button', label: 'x', action: { click: 'x-view/go' } } } };
    expect(denied(view, 'main')).toBe('plugin board: showView needs the action of the component a to be { event: { name, context? } }');
  });

  it('refuses an event name that is not a method this plugin registered', () => {
    const view = { root: 'a', components: { a: { id: 'a', component: 'Button', label: 'x', action: { event: { name: 'x-view/none' } } } } };
    expect(denied(view, 'main'))
      .toBe('plugin board: showView needs the action of the component a to name an x- method this plugin registered, and x-view/none is not one');
  });

  it('refuses a context that is not a JSON object', () => {
    const view = { root: 'a', components: { a: { id: 'a', component: 'Button', label: 'x', action: { event: { name: 'x-view/go', context: 'x' } } } } };
    expect(denied(view, 'main')).toBe('plugin board: showView needs the context of the component a to be a JSON object');
  });
});

describe('the check as a function', () => {
  it('passes a good view that names a method it was handed', () => {
    expect(() => { checkView(GOOD, 'main', 'board', { 'x-view/go': { by: 'board', name: 'x-view/go', method: { grant: 'demo:read', handle: () => ({}) } } }); }).not.toThrow();
  });
});

/*
 * A view whose props bind to its data model: the same check, for a plugin's
 * page and for a record's view alike. A prop may be `{ path }`, and a list may
 * repeat one component over the items at a path.
 */
const GO: Record<string, ServedMethod> = { 'x-view/go': { by: 'board', name: 'x-view/go', method: { grant: 'demo:read', handle: () => ({}) } } };

/** The message a bound view was refused with, or a failure saying it was not refused. */
const refusedBound = (view: unknown): string => refused(() => { checkView(view, 'main', 'board', GO); });

describe('a view bound to its data model', () => {
  it('passes with a prop bound to a path of the data', () => {
    const view: PluginView = {
      root: 'plan',
      components: {
        plan: { id: 'plan', component: 'Column', children: ['summary', 'open'] },
        summary: { id: 'summary', component: 'Text', text: { path: '/plan/summary' } },
        open: { id: 'open', component: 'Link', label: 'Plan', href: { path: '/plan/url' } },
      },
      dataModel: { plan: { summary: 'max', url: 'https://example.test/plan' } },
    };
    expect(() => { checkView(view, 'main', 'board', GO); }).not.toThrow();
  });

  it('passes a list that repeats a known component over a path', () => {
    const view: PluginView = {
      root: 'logins',
      components: {
        logins: { id: 'logins', component: 'List', children: { path: '/logins', componentId: 'login' } },
        login: { id: 'login', component: 'Text', text: { path: 'name' } },
      },
      dataModel: { logins: [{ name: 'work' }] },
    };
    expect(() => { checkView(view, 'main', 'board', GO); }).not.toThrow();
  });

  it('passes a Button that names a registered method, beside bound props', () => {
    const view: PluginView = {
      root: 'col',
      components: {
        col: { id: 'col', component: 'Column', children: ['n', 'go'] },
        n: { id: 'n', component: 'Text', text: { path: '/n' } },
        go: { id: 'go', component: 'Button', label: 'Go', action: { event: { name: 'x-view/go' } } },
      },
    };
    expect(() => { checkView(view, 'main', 'board', GO); }).not.toThrow();
  });

  it('passes a Progress and a DateTime, bound or literal', () => {
    const view: PluginView = {
      root: 'col',
      components: {
        col: { id: 'col', component: 'Column', children: ['bar', 'fixed', 'at', 'when'] },
        bar: { id: 'bar', component: 'Progress', label: { path: '/name' }, value: { path: '/used' }, max: 100, display: 'percent' },
        fixed: { id: 'fixed', component: 'Progress', value: 3, max: 4 },
        at: { id: 'at', component: 'DateTime', value: { path: '/reset' }, format: 'auto' },
        when: { id: 'when', component: 'DateTime', value: '2026-11-12T08:00:00.000Z', format: 'datetime' },
      },
      dataModel: { name: 'Session', used: 23, reset: '2026-11-06T09:10:00.000Z' },
    };
    expect(() => { checkView(view, 'main', 'board', GO); }).not.toThrow();
  });

  it('refuses a Progress or a DateTime whose literal it cannot draw', () => {
    const one = (component: Record<string, unknown>) => ({ root: 'a', components: { a: { id: 'a', ...component } } });
    expect(refusedBound(one({ component: 'Progress', value: 'half' })))
      .toBe('plugin board: showView needs the value of the Progress a to be a number or a { path } binding');
    expect(refusedBound(one({ component: 'DateTime', value: 'tomorrow' })))
      .toBe('plugin board: showView needs the value of the DateTime a to be an ISO time or a { path } binding');
    expect(refusedBound(one({ component: 'DateTime', value: { path: '/reset' }, format: 'relative' })))
      .toBe('plugin board: showView needs the format of the DateTime a to be one of time, date, datetime, auto');
  });

  it('refuses an unknown componentId', () => {
    const view = {
      root: 'logins',
      components: { logins: { id: 'logins', component: 'List', children: { path: '/logins', componentId: 'nope' } } },
    };
    expect(refusedBound(view))
      .toBe('plugin board: showView needs the children binding of the component logins to name a component, and nope is not one');
  });

  it('refuses a path binding with another member, or no path at all', () => {
    const extra = { root: 'a', components: { a: { id: 'a', component: 'Text', text: { path: '/x', fallback: 'y' } } } };
    expect(refusedBound(extra)).toBe('plugin board: showView needs a prop to be a literal or { path }, one path of the data');
    const noPath = { root: 'a', components: { a: { id: 'a', component: 'Text', text: { path: 5 } } } };
    expect(refusedBound(noPath)).toBe('plugin board: showView needs a prop to be a literal or { path }, one path of the data');
  });

  it('refuses a component kind a client is not promised', () => {
    const view = { root: 'a', components: { a: { id: 'a', component: 'Image', src: 'x' } } };
    expect(refusedBound(view)).toContain('to be one of Text, Link, Button, Card, Row, Column, List, Divider, Icon');
  });

  it('refuses a cycle, over the component a list repeats too', () => {
    const view = {
      root: 'a',
      components: {
        a: { id: 'a', component: 'List', children: { path: '/items', componentId: 'b' } },
        b: { id: 'b', component: 'Text', text: 'x', child: 'a' },
      },
    };
    expect(refusedBound(view)).toBe('plugin board: showView needs the components below root to be a tree without a cycle');
  });
});

describe('a canvas', () => {
  it('is still refused a URL that is not absolute http(s)', () => {
    const canvases = createCanvases({ dispatch: () => {}, holds: () => true, enabled: () => true });
    const state = { instanceId: 'board-1', extensionId: 'com.brbyte.canvas', canvasId: 'board' };
    expect(refused(() => canvases.open('ahp-chat:/c', { ...state, url: 'board/1' }, 'board')))
      .toBe('plugin board: openCanvas needs state.url to be an absolute http(s) URL with a host');
    expect(isWebUrl('https://example.test/x')).toBe(true);
    expect(isWebUrl('https://')).toBe(false);
  });
});
