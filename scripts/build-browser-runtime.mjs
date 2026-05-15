import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { build } from 'esbuild';

const root = resolve(import.meta.dirname, '..');
const placeholderPattern = /const BROWSER_RUNTIME_SOURCE = ['"]__CURSOR_MOTION_BROWSER_RUNTIME_SOURCE__['"];?/;

const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/browser-runtime.ts'],
  bundle: true,
  format: 'iife',
  globalName: '__CursorMotionBrowserRuntime',
  platform: 'browser',
  target: 'es2020',
  write: false,
  sourcemap: false,
  minify: false,
  treeShaking: true,
});

const runtimeSource = result.outputFiles[0]?.text;
if (!runtimeSource) {
  throw new Error('Failed to build browser runtime bundle');
}

const browserPath = resolve(root, 'dist/browser.js');
const browserSource = await readFile(browserPath, 'utf8');
if (!placeholderPattern.test(browserSource)) {
  throw new Error('Browser runtime placeholder was not found in dist/browser.js');
}

await writeFile(
  browserPath,
  browserSource.replace(placeholderPattern, `const BROWSER_RUNTIME_SOURCE = ${JSON.stringify(runtimeSource)};`)
);
