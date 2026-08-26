// Build: copy src/ to dist/.
//
// There is nothing to bundle. The page is ES modules, plain CSS, and one generated data
// module, all referenced with relative paths so dist/ works from any subdirectory of the site
// and from file:// as well.

import { readdirSync, statSync, copyFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist');

if (!existsSync(join(SRC, 'js/data.js'))) {
  console.error('src/js/data.js is missing. Run: npm run seed');
  process.exit(1);
}

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

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
console.log(`built dist/ · ${count} files from ${relative(ROOT, SRC)}/`);
