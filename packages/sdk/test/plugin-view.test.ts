import { describe, expect, it } from 'vitest';
import { createCanvases } from '../src/host/canvases.js';
import { pluginHost } from '../src/plugins/plugins.js';
import { checkView, literalOf, MAX_COMPONENTS } from '../src/plugins/view.js';
import { sdkVersion } from '../src/version.js';
import { isWebUrl } from '../src/weburl.js';
import type { HostRecordingOptions } from '../src/plugins/plugins.js';
import type { LoaderContext, PluginView } from '../src/types/plugin.js';

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
    expect(denied(GOOD, 'side')).toBe('plugin board: showView needs the surface to be main, the one surface a client draws');
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

  it('refuses a binding, and says that bindings come later', () => {
    const view = { root: 'a', components: { a: { id: 'a', component: 'Text', text: { path: '/x' } } } };
    expect(denied(view, 'main')).toBe('a view prop may not be a { path } binding: bindings come in a later plan');
    expect(() => { literalOf({ text: 'x' }); }).not.toThrow();
    expect(() => { literalOf({ path: '/x' }); }).toThrow('a view prop may not be a { path } binding: bindings come in a later plan');
  });

  it('refuses a Link whose href is not an absolute http(s) URL', () => {
    const view = { root: 'a', components: { a: { id: 'a', component: 'Link', label: 'x', href: 'board/1' } } };
    expect(denied(view, 'main')).toBe('plugin board: showView needs the Link a to have href as an absolute http(s) URL with a host');
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
