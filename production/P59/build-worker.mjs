import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const [template, frontend, styles] = await Promise.all([
  readFile(join(directory, 'worker-template.js'), 'utf8'),
  readFile(join(directory, 'frontend.js'), 'utf8'),
  readFile(join(directory, 'frontend.css'), 'utf8'),
]);

const assertLength = (label, value, expected) => {
  if (value.length !== expected) {
    throw new Error(`${label} was truncated or changed: ${value.length} instead of ${expected}`);
  }
};
assertLength('Worker template', template, 96346);
assertLength('Production frontend', frontend, 185644);
assertLength('Production styles', styles, 99370);

const replaceOnce = (source, token, value) => {
  if (source.indexOf(token) < 0 || source.indexOf(token) !== source.lastIndexOf(token)) {
    throw new Error(`Missing or non-unique template token: ${token}`);
  }
  return source.replace(token, () => value); // Preserve exact minified replacement text.
};
const workerWithClient = replaceOnce(
  template,
  'const RELEASE_JS = __PIDOR_JS__;',
  'const RELEASE_JS = ' + JSON.stringify(frontend) + ';',
);
const compiled = replaceOnce(
  workerWithClient,
  'const RELEASE_CSS = __PIDOR_CSS__;',
  'const RELEASE_CSS = ' + JSON.stringify(styles) + ';',
);
assertLength('Rebuilt production Worker P59', compiled, 383706);
if (!compiled.includes('release:"P59"') || !compiled.includes('cloudflare_worker_default as default')) {
  throw new Error('Reconstructed Worker did not pass P59 integrity checks');
}

const output = join(directory, 'dist', 'cloudflare-worker.js');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, compiled, 'utf8');
console.log(`Reconstructed PIDOR ONLINE P59: ${output} (${compiled.length} JavaScript characters)`);
 expansion inside minified JS.
};
const workerWithClient = replaceOnce(
  template,
  'const RELEASE_JS = __PIDOR_JS__;',
  'const RELEASE_JS = ' + JSON.stringify(frontend) + ';',
);
const compiled = replaceOnce(
  workerWithClient,
  'const RELEASE_CSS = __PIDOR_CSS__;',
  'const RELEASE_CSS = ' + JSON.stringify(styles) + ';',
);
assertLength('Rebuilt production Worker P59', compiled, 383706);
if (!compiled.includes('release:"P59"') || !compiled.includes('cloudflare_worker_default as default')) {
  throw new Error('Reconstructed Worker did not pass P59 integrity checks');
}

const output = join(directory, 'dist', 'cloudflare-worker.js');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, compiled, 'utf8');
console.log(`Reconstructed PIDOR ONLINE P59: ${output} (${compiled.length} JavaScript characters)`);
