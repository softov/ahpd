import type { HostTool } from './types/host.js';
import type { Bag } from './types/common.js';

/**
 * The tools an agent gets for recording what its session produced or found,
 * under VS Code's names.
 *
 * `artifactServerTools.ts` in the reference host names three, and its
 * `sessionArtifactCollection.ts` says what an entry is and what each answer
 * says. Both are copied rather than redesigned: an entry is `{ id, type,
 * label, isArtifact, link?, uri?, commitHash?, isGitHub? }`, the list lives
 * on the session's `_meta` under `agentHost/sessionArtifacts`, and the window
 * draws it beside the input as pills. The refusals are its refusals, word for
 * word, since the model reads them to fix the call.
 */

/** The key the reference client reads the list from. */
export const ARTIFACTS_META = 'agentHost/sessionArtifacts';

const TYPES = ['pullRequest', 'issue', 'commit', 'website', 'file', 'resource'] as const;
type ArtifactType = typeof TYPES[number];
const LINKED: ReadonlySet<ArtifactType> = new Set(['pullRequest', 'issue', 'website', 'commit']);
const ADDRESSED: ReadonlySet<ArtifactType> = new Set(['file', 'resource']);
const GITHUB: ReadonlySet<ArtifactType> = new Set(['pullRequest', 'issue']);

const ADD = 'add_artifact_or_reference';
const REMOVE = 'remove_artifact_or_reference';
const LIST = 'list_artifacts_and_references';

/** One entry, as the tool takes it and as it is kept. */
export interface Artifact {
  id: string;
  type: ArtifactType;
  label: string;
  isArtifact: boolean;
  link?: string;
  uri?: string;
  commitHash?: string;
  isGitHub?: boolean;
}

const requireString = (value: unknown, field: string, tool: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`Invalid ${tool} input: ${field} must be a non-empty string.`);
  return value.trim();
};

/**
 * A link opens outside, in whatever the desktop hands the scheme to, so only
 * the web is allowed: a `file:` link on an agent-labelled pill would launch a
 * local target.
 */
const requireWebLink = (value: unknown, field: string, tool: string): string => {
  const link = requireString(value, field, tool);
  let scheme: string;
  try { scheme = new URL(link).protocol; }
  catch { throw new Error(`Invalid ${tool} input: ${field} must be an absolute http(s) URL.`); }
  if (scheme !== 'http:' && scheme !== 'https:')
    throw new Error(`Invalid ${tool} input: ${field} must be an http(s) URL, but was '${scheme}'.`);
  return link;
};

/**
 * A URI the client can parse: with a scheme, and not a Windows drive letter
 * pretending to be one, which parses and then draws nothing.
 */
const requireUri = (value: unknown, field: string, tool: string): string => {
  const uri = requireString(value, field, tool);
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri)?.[1];
  if (scheme === undefined || scheme.length === 1)
    throw new Error(`Invalid ${tool} input: ${field} must be an absolute URI including its scheme, such as 'file:///path/to/file' \u2014 not a plain file system path.`);
  return uri;
};

/** Whether a pull request or issue link is GitHub's, which the window draws with its mark. */
export const isGitHubLink = (link: string): boolean => {
  try {
    const { hostname } = new URL(link);
    return hostname === 'github.com' || hostname === 'www.github.com' || hostname.endsWith('.github.com') || hostname.startsWith('github.');
  }
  catch { return false; }
};

/** One entry of `add_artifact_or_reference`, checked the way the reference host checks it. */
export const parseArtifact = (raw: unknown, tool: string, prefix?: string): Omit<Artifact, 'id'> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error(`Invalid ${tool} input: ${prefix ? `${prefix} must be an object.` : 'expected an object.'}`);
  const args = raw as Record<string, unknown>;
  const field = (name: string): string => (prefix ? `${prefix}.${name}` : name);
  const type = args.type;
  if (typeof type !== 'string' || !(TYPES as readonly string[]).includes(type))
    throw new Error(`Invalid ${tool} input: ${field('type')} must be one of ${TYPES.join(', ')}.`);
  if (typeof args.isArtifact !== 'boolean')
    throw new Error(`Invalid ${tool} input: ${field('isArtifact')} must be a boolean \u2014 true for an artifact, false for a reference.`);
  const kind = type as ArtifactType;
  const out: Omit<Artifact, 'id'> = { type: kind, label: requireString(args.label, field('label'), tool), isArtifact: args.isArtifact };
  if (LINKED.has(kind)) out.link = requireWebLink(args.link, field('link'), tool);
  if (ADDRESSED.has(kind)) out.uri = requireUri(args.uri, field('uri'), tool);
  if (kind === 'commit') out.commitHash = requireString(args.commitHash, field('commitHash'), tool);
  if (out.link !== undefined && GITHUB.has(kind)) out.isGitHub = isGitHubLink(out.link);
  return out;
};

/** The batch, or the older single-entry shape, which is still taken. */
export const parseArtifacts = (raw: unknown, tool: string): Omit<Artifact, 'id'>[] => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Invalid ${tool} input: expected an object.`);
  const items = (raw as Record<string, unknown>).items;
  if (items === undefined) return [parseArtifact(raw, tool)];
  if (!Array.isArray(items) || items.length === 0) throw new Error(`Invalid ${tool} input: items must be a non-empty array.`);
  return items.map((item, index) => parseArtifact(item, tool, `items[${index}]`));
};

/** What makes two entries the same one: the thing they point at. */
const valueOf = (one: Omit<Artifact, 'id'>): string => one.link ?? one.uri ?? one.commitHash ?? '';

const noun = (isArtifact: boolean): string => (isArtifact ? 'artifact' : 'reference');

const describe = (one: Artifact): string => {
  const value = valueOf(one);
  return `${one.id} (${one.type}, ${noun(one.isArtifact)}) ${one.label}${value ? ` \u2014 ${value}` : ''}`;
};

/** One `add` outcome: the list as it now stands, the entry it is about, and how it was answered. */
export interface Recorded {
  held: Artifact[];
  artifact: Artifact;
  status: string;
}

/*
 * The reference's `addOrPromoteArtifact`, copied rather than redesigned.
 *
 * A value the session already holds as a reference is promoted to an artifact
 * in place and keeps the id it had; a new value is added under a minted id;
 * anything else is already recorded. An artifact arriving as a reference is
 * never downgraded, which is the half a duplicate answer has to protect.
 */
export const recordArtifact = (held: Artifact[], one: Omit<Artifact, 'id'>, mintId: () => string): Recorded => {
  const same = held.find((other) => valueOf(other) === valueOf(one));
  if (same === undefined) {
    const made: Artifact = { id: mintId(), ...one };
    return { held: [...held, made], artifact: made, status: `Added ${noun(one.isArtifact)}` };
  }
  if (same.isArtifact === false && one.isArtifact === true) {
    const artifact: Artifact = { id: same.id, ...one };
    return {
      held: held.map((other) => (other === same ? artifact : other)),
      artifact,
      status: 'Promoted artifact',
    };
  }
  return { held, artifact: same, status: 'Already recorded' };
};

/** The recorded list, as a store holds it; a malformed entry is left out rather than drawn wrong. */
export const artifactsIn = (held: Bag[] | undefined): Artifact[] => (held ?? []).flatMap((raw) => {
  if (typeof raw.id !== 'string' || typeof raw.label !== 'string' || typeof raw.type !== 'string' || !(TYPES as readonly string[]).includes(raw.type)) return [];
  if (raw.isArtifact !== undefined && typeof raw.isArtifact !== 'boolean') return [];
  const one: Artifact = { id: raw.id, type: raw.type as ArtifactType, label: raw.label, isArtifact: raw.isArtifact ?? true };
  if (typeof raw.link === 'string') one.link = raw.link;
  if (typeof raw.uri === 'string') one.uri = raw.uri;
  if (typeof raw.commitHash === 'string') one.commitHash = raw.commitHash;
  if (typeof raw.isGitHub === 'boolean') one.isGitHub = raw.isGitHub;
  return [one];
});

const CLASSIFICATION = 'An issue or pull request you create or attempt to fix, change, or unblock is an artifact; inspection or review alone makes it a reference.';

const entrySchema = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: [...TYPES], description: 'The kind of artifact or reference. Use `resource` only when no other kind applies.' },
    label: { type: 'string', description: 'Short label shown to the user.' },
    isArtifact: { type: 'boolean', description: `Required. \`true\` for an artifact, \`false\` for a reference. ${CLASSIFICATION} Other artifacts are deliverables the user requested or standalone results they are clearly likely to reopen, download, or reuse, such as a report the user asked for. References are existing resources the user should look at because of this task.` },
    link: { type: 'string', description: 'URL of the pull request, issue, commit or website. Required for those kinds.' },
    uri: { type: 'string', description: 'Absolute URI including its scheme. For a local file, pass a file URI such as `file:///C:/path/to/file`, not a plain file system path such as `C:\\path\\to\\file`. Required for the `file` and `resource` kinds.' },
    commitHash: { type: 'string', description: 'The commit hash. Required for the `commit` kind.' },
  },
  required: ['type', 'label', 'isArtifact'],
};

/**
 * The instruction the reference host adds to a session's first turn while
 * these tools are offered, so the model knows when to call them. Here it
 * goes into the agent's instructions, which is the same thing said once.
 */
const ARTIFACT_TOOLS_INSTRUCTION = `Record notable artifacts and references with \`${ADD}\` so they are surfaced next to the chat input. Registration is optional, not an inventory of everything saved; default to no registration. ${CLASSIFICATION} Other artifacts are deliverables the user explicitly requested or standalone results the user is clearly likely to reopen, download, or reuse; references are existing resources the user will likely want to view. Batch related entries in one call when practical. Do not record routine files, scratch files, caches, logs, intermediate results, or configuration snapshots unless the user asked for them as deliverables; persistence or location outside the workspace is not an eligibility signal. Do not record incidental resources, commits you create unless the user asks, or sessions and chats created with session-management tools. Never create, copy, or relocate a file solely to have an artifact to register.`;

/*
 * The compact wording, copied from the reference host's `getDefinitions`.
 *
 * A client that pushes `artifactToolsCompactPrompts` gets the short
 * instruction and a short ADD description instead of the long ones. The tool
 * set is unchanged: the same three are offered, in the same order, and the
 * compact treatment only selects words.
 */
export const COMPACT_ARTIFACT_TOOLS_INSTRUCTION = `Artifact registration is optional; default to none. Follow \`${ADD}\` eligibility rules and batch related entries. List/remove (discover if needed): \`${LIST}\`, \`${REMOVE}\`.`;

/** The short ADD description the compact key selects, which still names the tool. */
const COMPACT_ADD_DESCRIPTION = 'Record artifacts and references so they are surfaced next to the chat input. Call `add_artifact_or_reference` with `items`, batch related entries in one call when practical, and default to none. Adding an artifact promotes a matching reference, preserving its id.';

export const artifactTools = (): HostTool[] => [
  {
    definition: {
      name: ADD,
      title: 'Add Artifact or Reference',
      description: `Record one or more artifacts or references so they are surfaced next to the chat input. Use \`items\` and batch related entries in one call when practical. Registration is optional, not an inventory of everything saved; default to no registration. ${CLASSIFICATION} Other artifacts are deliverables the user requested or standalone results they are clearly likely to reopen, download, or reuse, such as a report or plan the user asked for. References are noteworthy existing resources the user will likely want to view. Do not record routine files, scratch files, caches, logs, intermediate results, or configuration snapshots unless the user asked for them as deliverables; persistence or location outside the workspace is not an eligibility signal. Do not record incidental resources or sessions and chats created with session-management tools. Never create, copy, or relocate a file solely to have an artifact to register.`,
      inputSchema: {
        type: 'object',
        properties: {
          items: { type: 'array', minItems: 1, description: 'Artifacts and references to record in this call. Batch related entries when practical.', items: entrySchema },
        },
        required: ['items'],
      },
      annotations: { readOnlyHint: false },
    },
    instruction: ARTIFACT_TOOLS_INSTRUCTION,
    compact: {
      definition: { description: COMPACT_ADD_DESCRIPTION },
      instruction: COMPACT_ARTIFACT_TOOLS_INSTRUCTION,
    },
    /*
     * The reference's rule: the add tool the instruction names is never
     * deferred, and remove and list are, since the model reaches them through
     * the discovery the instruction points at.
     */
    deferLoading: false,
    run: (input, at) => {
      const wanted = parseArtifacts(input, ADD);
      for (const one of wanted) {
        if (one.uri !== undefined && /^agent-host-session:/i.test(one.uri))
          throw new Error(`Invalid ${ADD} input: sessions and chats created with session-management tools must not be recorded as artifacts or references.`);
      }
      const said: string[] = [];
      let held = artifactsIn(at.artifacts());
      for (const one of wanted) {
        const recorded = recordArtifact(held, one, () => crypto.randomUUID());
        held = recorded.held;
        said.push(`${recorded.status}: ${recorded.artifact.id}`);
      }
      at.setArtifacts(held as unknown as Bag[]);
      return said.join('\n');
    },
  },
  {
    definition: {
      name: REMOVE,
      title: 'Remove Artifact or Reference',
      description: 'Remove an artifact or reference from this session by id.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: `The id returned by \`${ADD}\` or \`${LIST}\`.` } },
        required: ['id'],
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    deferLoading: true,
    run: (input, at) => {
      const id = input.id;
      if (typeof id !== 'string' || id.length === 0) throw new Error(`Invalid ${REMOVE} input: id must be a non-empty string.`);
      const held = artifactsIn(at.artifacts());
      const gone = held.find((one) => one.id === id);
      if (gone === undefined) return `No artifact or reference with id ${id}.`;
      at.setArtifacts(held.filter((one) => one !== gone) as unknown as Bag[]);
      return `${gone.isArtifact ? 'Removed artifact' : 'Removed reference'}: ${gone.id}`;
    },
  },
  {
    definition: {
      name: LIST,
      title: 'List Artifacts and References',
      description: 'List the artifacts and references recorded on this session, with their ids.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
    },
    deferLoading: true,
    run: (_input, at) => {
      const held = artifactsIn(at.artifacts());
      return held.length === 0 ? 'No artifacts or references recorded for this session.' : held.map(describe).join('\n');
    },
  },
];
