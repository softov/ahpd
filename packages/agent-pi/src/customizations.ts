/**
 * pi's skills, prompt templates and extensions in the protocol's customization
 * model.
 *
 * pi loads each kind from its folders, the agent directory's and a trusted
 * project's `.pi`, and from the packages a person installed. A folder is a
 * `Directory` holding the one kind found in it, as VS Code's discovery groups
 * customizations by the folder they were found in, and a package is a `Plugin`
 * holding its kinds. A skill is a `Skill`, a prompt template a `Prompt`, and an
 * extension a `Hook`: pi's extensions are its hooks and custom tools in one
 * ("This release unifies hooks and custom tools into a single "extensions"
 * system and renames "slash commands" to "prompt templates"", the CHANGELOG
 * pi 1.3.0 ships, L4713). Every id is the customization's URI, VS Code's
 * `customizationId`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/sessionCustomizationDiscovery.ts#L1041-L1078
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L481-L487
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L914-L927
 */

import { basename, dirname } from 'node:path';
import { uriOf } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';
import type { Extension, PromptTemplate, Skill, SourceInfo } from '@earendil-works/pi-coding-agent';

/** What pi loaded for one session, each as its own loader lists it. */
export interface PiResources {
  skills: Skill[];
  prompts: PromptTemplate[];
  extensions: Extension[];
}

/**
 * Whether pi names an extension by no file: a built-in, `builtin:<name>`, or
 * one given inline, `<inline:name>`, as pi's own `isSyntheticPath` reads one.
 */
const fileless = (path: string): boolean => path.startsWith('builtin:') || path.startsWith('<');

/** One resource as the child customization it is, with the file pi loaded and where pi found it. */
interface Child {
  customization: Bag;
  path: string;
  source: SourceInfo;
}

/**
 * The customizations a session lists, each container holding what pi found in
 * it, a child or a container among `off` listed switched off.
 *
 * An extension pi names by no file, a built-in or one given inline, as this
 * host's own is, sits in no folder and is not listed.
 */
export function piCustomizations(resources: PiResources, off: ReadonlySet<string>): Bag[] {
  const switched = (id: string): Bag => (off.has(id) ? { enabled: false } : {});
  const children: Child[] = [
    ...resources.skills.map((skill): Child => ({
      path: skill.filePath,
      source: skill.sourceInfo,
      customization: {
        type: 'skill',
        id: uriOf(skill.filePath),
        uri: uriOf(skill.filePath),
        name: skill.name,
        ...(skill.description !== '' ? { description: skill.description } : {}),
        ...(skill.disableModelInvocation ? { disableModelInvocation: true } : {}),
        ...switched(uriOf(skill.filePath)),
      },
    })),
    ...resources.prompts.map((prompt): Child => ({
      path: prompt.filePath,
      source: prompt.sourceInfo,
      customization: {
        type: 'prompt',
        id: uriOf(prompt.filePath),
        uri: uriOf(prompt.filePath),
        name: prompt.name,
        ...(prompt.description !== '' ? { description: prompt.description } : {}),
        ...switched(uriOf(prompt.filePath)),
      },
    })),
    ...resources.extensions
      .filter((extension) => !fileless(extension.path))
      .map((extension): Child => ({
        path: extension.path,
        source: extension.sourceInfo,
        customization: {
          type: 'hook',
          id: uriOf(extension.resolvedPath),
          uri: uriOf(extension.resolvedPath),
          name: basename(extension.path).replace(/\.[cm]?[jt]s$/, ''),
          ...switched(uriOf(extension.resolvedPath)),
        },
      })),
  ];
  const containers = new Map<string, Bag & { children: Bag[] }>();
  for (const child of children) {
    const folder = child.source.baseDir ?? dirname(child.path);
    const kind = String(child.customization.type);
    const packaged = child.source.origin === 'package';
    const key = packaged ? folder : `${folder}\n${kind}`;
    let held = containers.get(key);
    if (held === undefined) {
      const id = uriOf(folder);
      held = packaged
        ? {
            type: 'plugin', id, uri: id, name: basename(folder),
            enablement: [{ kind: 'session', enabled: !off.has(id) }], load: { kind: 'loaded' }, children: [],
          }
        : {
            type: 'directory', id, uri: id, name: basename(folder), enabled: !off.has(id), contents: kind,
            writable: child.source.scope !== 'temporary', load: { kind: 'loaded' }, children: [],
          };
      containers.set(key, held);
    }
    held.children.push(child.customization);
  }
  for (const held of containers.values()) {
    held.children.sort((one, other) => String(one.uri).localeCompare(String(other.uri)));
  }
  return [...containers.values()];
}

/**
 * The files of the children `off` switches off, by their own id or by their
 * container's: what pi's loader leaves out when it is built again.
 */
export function switchedOffPaths(resources: PiResources, off: ReadonlySet<string>): Set<string> {
  const paths = new Set<string>();
  const out = (path: string, id: string, source: SourceInfo): void => {
    if (off.has(id) || off.has(uriOf(source.baseDir ?? dirname(path)))) paths.add(path);
  };
  for (const skill of resources.skills) out(skill.filePath, uriOf(skill.filePath), skill.sourceInfo);
  for (const prompt of resources.prompts) out(prompt.filePath, uriOf(prompt.filePath), prompt.sourceInfo);
  for (const extension of resources.extensions) {
    if (!fileless(extension.path)) out(extension.path, uriOf(extension.resolvedPath), extension.sourceInfo);
  }
  return paths;
}
