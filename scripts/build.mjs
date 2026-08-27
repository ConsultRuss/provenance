// Build: copy src/ to dist/.
//
// There is nothing to bundle. The page is ES modules, plain CSS, and one generated data
// module, all referenced with relative paths so dist/ works from any subdirectory of the site
// and from file:// as well.

import { readdirSync, statSync, copyFileSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

if (!existsSync(join(SRC, 'js/data.js'))) {
  console.error('src/js/data.js is missing. Run: npm run seed');
  process.exit(1);
}

// Empty dist/ rather than removing it. A preview server with dist/ as its working directory
// holds a lock on the folder, and rebuilding underneath one is the normal case, not an edge.
mkdirSync(DIST, { recursive: true });
for (const name of readdirSync(DIST)) {
  rmSync(join(DIST, name), { recursive: true, force: true });
}

let count = 0;
function copyInto(from, to) {
  mkdirSync(to, { recursive: true });
  // Sorted, so the build walks the tree in the same order every time.
  for (const name of readdirSync(from).sort()) {
    const source = join(from, name);
    const target = join(to, name);
    if (statSync(source).isDirectory()) copyInto(source, target);
    else {
      copyFileSync(source, target);
      count += 1;
    }
  }
}

copyInto(SRC, DIST);

/* ------------------------------------------------------------ cache stamp --- */

// Filenames here are stable (app.css, provenance.js), and the host serves assets with a four
// hour browser cache. That combination means a visitor who has seen the page keeps the old CSS
// and JS for hours after a deploy — long enough to look at a fix that is live and be shown the
// previous version instead. It happened during development and cost real time.
//
// So every asset reference gets ?v=<stamp>, where the stamp is a hash of all the built files.
// The URL changes whenever any source changes and is identical when nothing has, which makes a
// long cache correct rather than something to fight. One stamp for the whole build rather than
// one per file: a per-file hash would cascade through the import graph for no practical gain.

function allFiles(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) allFiles(path, out);
    else out.push(path);
  }
  return out;
}

const built = allFiles(DIST);
const stamp = createHash('sha256')
  .update(built.map((f) => `${relative(DIST, f)}\n${readFileSync(f, 'utf8')}`).join('\0'))
  .digest('hex')
  .slice(0, 8);

let stamped = 0;
for (const file of built) {
  if (!['.html', '.js', '.css'].includes(extname(file))) continue;
  const before = readFileSync(file, 'utf8');
  const after = before
    // <link href="./styles/app.css">, <script src="./js/app.js">
    .replace(/((?:href|src)=")(\.\/[^"?]+\.(?:css|js))(")/g, `$1$2?v=${stamp}$3`)
    // import … from './data.js'  and  await import('./pdf.js')
    .replace(/(from\s+'|import\('|import\s+')(\.\/[^'?]+\.js)(')/g, `$1$2?v=${stamp}$3`);
  if (after !== before) {
    writeFileSync(file, after, 'utf8');
    stamped += 1;
  }
}

console.log(`built dist/ · ${count} files from ${relative(ROOT, SRC)}/ · cache stamp ${stamp} in ${stamped} files`);
