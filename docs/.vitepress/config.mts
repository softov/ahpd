import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type DefaultTheme, type Plugin } from 'vitepress';
import { releases } from './releases';

/** The `docs/` folder, which is the site's source. */
const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The repository root, which a link that leaves `docs/` is resolved against. */
const ROOT = resolve(DOCS, '..');

/** Where a file outside `docs/` is shown, at the branch the site is built from. */
const GITHUB = 'https://github.com/softov/ahpd';

const { description } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { description: string };

/** One sidebar entry: the text it shows and the page it opens. */
const page = (text: string, link: string): DefaultTheme.SidebarItem => ({ text, link });

/** The docs sidebar: one group per folder, each in the order `docs/README.md` lists it. */
const sidebar: DefaultTheme.SidebarItem[] = [
  {
    text: 'Server',
    items: [
      page('Get started', '/server/GET-STARTED'),
      page('Install', '/server/INSTALL'),
      page('Upgrade', '/server/UPGRADE'),
      page('Run', '/server/RUN'),
      page('Configure', '/server/CONFIGURE'),
      page('Plugins', '/server/PLUGINS'),
      page('Connect a client', '/server/CONNECT'),
      page('Remote access', '/server/REMOTE'),
      page('Users', '/server/USERS'),
      page('Vault', '/server/VAULT'),
      page('Usage', '/server/USAGE'),
      page('Proxy', '/server/PROXY'),
      page('MCP', '/server/MCP'),
      page('Reference', '/server/REFERENCE'),
    ],
  },
  {
    text: 'SDK',
    items: [
      page('AHP', '/sdk/AHP'),
      page('Agent', '/sdk/AGENT'),
      page('Build your own host', '/sdk/BUILD-A-HOST'),
      page('Host', '/sdk/HOST'),
      page('Sessions', '/sdk/SESSIONS'),
      page('Chats', '/sdk/CHATS'),
      page('Resources', '/sdk/RESOURCES'),
      page('Tools', '/sdk/TOOLS'),
      page('Terminals', '/sdk/TERMINALS'),
      page('Automations', '/sdk/AUTOMATIONS'),
      page('Policy', '/sdk/POLICY'),
      page('Usage', '/sdk/USAGE'),
      page('Users', '/sdk/USERS'),
      page('Authentication', '/sdk/AUTHENTICATION'),
    ],
  },
  {
    text: 'Plugins',
    items: [
      page('Writing a plugin', '/plugins/PLUGINS'),
      page('@ahpd/agent-acp', '/plugins/agent-acp'),
      page('@ahpd/agent-claude', '/plugins/agent-claude'),
      page('@ahpd/agent-cofold', '/plugins/agent-cofold'),
      page('@ahpd/agent-pi', '/plugins/agent-pi'),
      page('@ahpd/bot', '/plugins/bot'),
      page('Bots', '/plugins/BOTS'),
      page('@ahpd/activepieces', '/plugins/activepieces'),
      page('@ahpd/computer', '/plugins/computer'),
      page('Computer', '/plugins/COMPUTERS'),
      page('Containers', '/plugins/CONTAINERS'),
      page('@ahpd/push', '/plugins/push'),
      page('@ahpd/tasks', '/plugins/tasks'),
      page('Tasks', '/plugins/TASK-LIST'),
      page('@ahpd/tunnel-devtunnel', '/plugins/tunnel-devtunnel'),
      page('@ahpd/webhook', '/plugins/webhook'),
      page('Webhooks', '/plugins/WEBHOOKS'),
    ],
  },
];

/** How many releases the releases sidebar shows before *View all releases*. */
const RECENT = 10;

/** The sidebar of a page under `docs/updates/`: the newest releases, then the archive. */
const updates: DefaultTheme.SidebarItem[] = [
  {
    text: 'Updates',
    items: [
      ...releases().slice(0, RECENT).map((release) => page(release.version, release.link)),
      page('View all releases', '/updates/archive'),
    ],
  },
];

/** Every page under `docs/`, as a site path such as `/server/RUN`. */
const pages = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  if (entry.startsWith('.') || entry === 'node_modules' || entry === 'public') return [];
  const path = join(dir, entry);
  if (statSync(path).isDirectory()) return pages(path);
  if (!entry.endsWith('.md')) return [];
  return ['/' + relative(DOCS, path).split(sep).join('/').replace(/\.md$/, '')];
});

/** The pages that are not in the sidebar: the home page and the index of all documents. */
const UNLISTED = new Set(['/index', '/README']);

const listed = new Set([...sidebar, ...updates].flatMap((group) => group.items ?? []).map((item) => item.link));
const missing = pages(DOCS).filter((path) => !UNLISTED.has(path) && !listed.has(path));
if (missing.length > 0) {
  throw new Error(`docs/.vitepress/config.mts: in no sidebar: ${missing.map((path) => `docs${path}.md`).join(', ')}`);
}

/** The comment that marks where an included file starts, with the folder its links are relative to. */
const FROM = /^<!--\s*ahpd-from:\s*(.*?)\s*-->\s*$/;

/**
 * The inline HTML a page may use. Anything else in angle brackets, such as the
 * placeholder in `x-ahpd/<domain>/<verb>`, is shown as text.
 */
const HTML = /^(<!--|<\/?(a|abbr|b|br|code|del|details|em|i|img|kbd|s|span|strong|sub|summary|sup|u)[\s/>])/i;

/** The comment that marks where an included file ends. */
const END = /^<!--\s*ahpd-from-end\s*-->\s*$/;

/**
 * Marks each `@include` in a page with the folder of the file it includes.
 *
 * VitePress inlines an included file before Markdown sees the page, so a
 * relative link in it would resolve against the page. The marks let the link
 * rewrite resolve it against the included file's own folder.
 */
const markIncludes: Plugin = {
  name: 'ahpd-mark-includes',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('.md') || !id.startsWith(DOCS)) return;
    return code.replace(/^<!--\s*@include:\s*(.*?)(\{\d*,\d*\})?\s*-->\s*$/gm, (line, target: string) => {
      const folder = relative(ROOT, dirname(resolve(dirname(id), target))).split(sep).join('/');
      return `<!-- ahpd-from: ${folder} -->\n\n${line}\n\n<!-- ahpd-from-end -->`;
    });
  },
};

/**
 * A relative link as the site serves it.
 *
 * A link to a page inside `docs/` stays relative to the page. A link that leaves
 * `docs/` becomes the file on GitHub, `blob` for a file and `tree` for a folder.
 */
const rewrite = (href: string, from: string, page: string): string => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return href;
  const hash = href.indexOf('#');
  const path = hash === -1 ? href : href.slice(0, hash);
  const anchor = hash === -1 ? '' : href.slice(hash);
  const target = resolve(from, decodeURI(path));
  const inside = relative(DOCS, target);
  if (!inside.startsWith('..') && !inside.startsWith('.vitepress')) {
    const local = relative(dirname(page), target).split(sep).join('/') || '.';
    return local + anchor;
  }
  const kind = existsSync(target) && statSync(target).isDirectory() ? 'tree' : 'blob';
  const repo = relative(ROOT, target).split(sep).join('/');
  return `${GITHUB}/${kind}/main/${encodeURI(repo)}${anchor}`;
};

export default defineConfig({
  title: 'ahpd',
  description,
  base: process.env.DOCS_BASE ?? '/ahpd/',
  cleanUrls: true,
  lastUpdated: true,

  markdown: {
    config(md) {
      // Inline code is shown as written, so a `{{name}}` in it is text and not a Vue expression.
      const code = md.renderer.rules.code_inline!;
      md.renderer.rules.code_inline = (tokens, index, options, env, self) => {
        tokens[index]!.attrSet('v-pre', '');
        return code(tokens, index, options, env, self);
      };

      md.core.ruler.push('ahpd-relative-links', (state) => {
        const page: string | undefined = state.env?.path;
        if (page === undefined) return;
        let from = dirname(page);
        for (const token of state.tokens) {
          if (token.type === 'html_block') {
            const start = FROM.exec(token.content);
            if (start) from = join(ROOT, start[1] ?? '');
            else if (END.test(token.content)) from = dirname(page);
            continue;
          }
          for (const child of token.children ?? []) {
            if (child.type === 'html_inline' && !HTML.test(child.content)) child.type = 'text';
            if (child.type !== 'link_open') continue;
            const href = child.attrGet('href');
            if (href) child.attrSet('href', rewrite(href, from, page));
          }
        }
      });
    },
  },

  vite: {
    plugins: [markIncludes],
  },

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Updates', link: releases()[0]?.link ?? '/updates/archive', activeMatch: '^/updates/' },
      { text: 'All documents', link: '/README' },
      { text: 'GitHub', link: GITHUB },
    ],
    sidebar: { '/updates/': updates, '/': sidebar },
    search: { provider: 'local' },
    editLink: {
      pattern: `${GITHUB}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
  },
});
