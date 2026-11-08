import { expect, it } from 'vitest';
import { questionsFor } from '../src/mapping.js';

/*
 * A form's fields as the questions a person is asked.
 *
 * A titled multi-select carries its options on its items' `anyOf`, as ACP's
 * schema writes one and VS Code's mappers read it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeElicitation.ts#L221-L222
 */
it('reads a titled multi-select\'s options from its items\' anyOf', () => {
  const [labels] = questionsFor({
    type: 'object',
    properties: {
      labels: {
        type: 'array',
        title: 'Labels',
        items: { anyOf: [{ const: 'bug', title: 'Bug' }, { const: 'docs', title: 'Documentation' }] },
      },
    },
  });
  expect(labels).toMatchObject({
    id: 'labels',
    kind: 'multi-select',
    options: [{ id: 'bug', label: 'Bug' }, { id: 'docs', label: 'Documentation' }],
  });
});
