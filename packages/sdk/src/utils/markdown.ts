/**
 * The text helpers VS Code's agents word a tool call's lines with, as VS Code
 * has them, so every backend that words a line as VS Code's agents do cuts
 * and fences it the same way.
 */

/**
 * VS Code's `truncate`: the first `maxLength` characters and an ellipsis.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/strings.ts#L106-L112
 */
export const truncate = (value: string, maxLength: number): string =>
  (value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`);

/**
 * VS Code's `appendEscapedMarkdownInlineCode`: inline code whose fence is one
 * backtick longer than any run of backticks in the text, padded with a space
 * where the text starts or ends with one.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/htmlContent.ts#L236-L242
 */
export const appendEscapedMarkdownInlineCode = (text: string): string => {
  const fence = '`'.repeat(Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length)) + 1);
  const content = text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text;
  return `${fence}${content}${fence}`;
};
