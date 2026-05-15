import { copyFile, readFile, writeFile } from 'node:fs/promises';

const input = new URL('../dist/browser.js', import.meta.url);
const output = new URL('../dist/browser.cjs', import.meta.url);

let code = await readFile(input, 'utf8');

code = code
  .replace(/^export const (CURSOR_MOTION_BROWSER_STYLE|CURSOR_MOTION_BROWSER_SCRIPT) =/gm, 'const $1 =')
  .replace(/^export function (createCursorMotionBrowserStyle|createCursorMotionBrowserScript)\(/gm, 'function $1(');

code += `
module.exports = {
  CURSOR_MOTION_BROWSER_STYLE,
  CURSOR_MOTION_BROWSER_SCRIPT,
  createCursorMotionBrowserStyle,
  createCursorMotionBrowserScript,
};
`;

await writeFile(output, code);

await copyFile(new URL('../dist/browser.d.ts', import.meta.url), new URL('../dist/browser.d.cts', import.meta.url));
