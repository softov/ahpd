export { botCatalogue, CATALOGUE, CATALOGUE_SCHEME } from './catalogue.js';
export type { BotCatalogue, Catalogue } from './catalogue.js';
export { apply, defaults, name, title } from './plugin.js';
export { botProvider } from './provider.js';
export type { BotOptions, BotProvider } from './provider.js';
export type { BotSessions } from './wake.js';
export {
  ALREADY_EXISTS, BOT_BODIES, BOT_COLORS, checkRecord, CONFLICT, INVALID_PARAMS, isBotColor, isSlug, NOT_FOUND,
} from './record.js';
export type { BotBody, BotColor, BotDraft, BotRecord } from './record.js';
export {
  agentsFilled, agentsTemplatePath, agentsTextOf, DEFAULT_AGENTS_TEMPLATE, defaultAgentsTemplate,
} from './template.js';
export type { BotTemplates } from './template.js';
export { botStore } from './store.js';
export type { BotStore } from './store.js';
