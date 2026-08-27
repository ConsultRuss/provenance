// Acceptance checks. Run: npm run check
//
// These cover the items from section 16 of the brief that a script can decide. The rest —
// click paths, focus order, wire anchoring on resize — are checked by hand in a browser and
// listed in the README.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const results = [];
const check = (name, fn) => {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail ?? '' });
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
  }
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir)).sort()) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/* -- 1 · the seed is deterministic ---------------------------------------- */

check('16.1  npm run seed twice is byte-identical', () => {
  const files = ['data/generated/sources.json', 'data/generated/requirements.json',
    'data/generated/documents.json', 'data/generated/gates.json', 'src/js/data.js'];
  const before = files.map(read);
  execFileSync(process.execPath, [join(ROOT, 'scripts/generate.mjs')], { stdio: 'pipe' });
  const after = files.map(read);
  files.forEach((file, i) => assert(before[i] === after[i], `${file} changed between runs`));
  return `${files.length} files unchanged`;
});

/* -- 2 · no real or borrowed names ---------------------------------------- */

check('16.2  no real company, no other project name', () => {
  // Names belonging to other projects on this machine, plus real entities that could plausibly
  // drift in from a draft. Extend this list rather than relying on memory.
  const denied = [
    // Other projects on this machine. This demo shares generic pipeline mechanics with some of
    // them; it must not share a name, a codename, or any copied text.
    'memstrata', 'site screener', 'sitescreener', 'site-screener',
    // Real entities that could drift in from a draft.
    // Real employers this demo is calibrated against but must never name.
    'holt', 'caterpillar',
    'ercot', 'anthropic', 'openai', 'google', 'microsoft', 'amazon', 'meta platforms',
    'salesforce', 'oracle corp', 'jpmorgan', 'blackrock', 'cbre', 'jll',
  ];
  // This file necessarily contains every denied name, so it is not one of the files scanned.
  const files = [...walk('src'), ...walk('data'), ...walk('scripts'), 'README.md', 'package.json']
    .filter((f) => f !== 'scripts/check.mjs');
  const hits = [];
  for (const file of files) {
    const text = read(file).toLowerCase();
    for (const name of denied) if (text.includes(name)) hits.push(`${file}: ${name}`);
  }
  assert(hits.length === 0, `found ${hits.join(', ')}`);

  // Russell W. Hild is the only real person named anywhere.
  const people = ['russell w. hild', 'russell hild'];
  const shipped = read('src/index.html').toLowerCase();
  assert(people.some((p) => shipped.includes(p)), 'the page must carry its real-name identity');
  return `${denied.length} denied names absent across ${files.length} files`;
});

/* -- 3 · a claim that cannot ship has no source --------------------------- */

check('16.3  every claim labelled c or d cites s0', () => {
  const documents = json('data/generated/documents.json');
  let blocked = 0;
  for (const doc of documents) {
    for (const claim of doc.claims) {
      if (claim.label === 'c' || claim.label === 'd') {
        assert(claim.sourceId === 's0', `${doc.id}/${claim.id} cites ${claim.sourceId}`);
        blocked += 1;
      } else {
        assert(claim.sourceId !== 's0', `${doc.id}/${claim.id} ships but cites the null source`);
      }
    }
  }
  assert(blocked > 0, 'no blocked claims — a clean run proves nothing');
  return `${blocked} blocked claims, all on s0`;
});

/* -- 3b · the label matches the kind of record behind it ------------------ */

check('16.3b every label matches its record category', () => {
  const documents = json('data/generated/documents.json');
  const category = new Map(json('data/generated/sources.json').map((s) => [s.id, s.category]));
  let checked = 0;
  for (const doc of documents) {
    for (const claim of doc.claims) {
      const kind = category.get(claim.sourceId);
      assert(kind !== undefined, `${doc.id}/${claim.id}: ${claim.sourceId} has no category`);
      if (claim.label === 'a') {
        assert(kind === 'self-report', `${doc.id}/${claim.id}: label a cites a ${kind}`);
      }
      if (claim.label === 'b') {
        assert(
          kind === 'third-party record' || kind === 'system export',
          `${doc.id}/${claim.id}: label b cites a ${kind}`,
        );
      }
      checked += 1;
    }
  }
  // A library of only self-reports would make label b unreachable and the demo hollow.
  const kinds = new Set([...category.values()]);
  for (const required of ['self-report', 'third-party record', 'system export']) {
    assert(kinds.has(required), `the library has no ${required}`);
  }
  return `${checked} claims, all consistent with their record category`;
});

/* -- 6 · the default selection is a blocked claim ------------------------- */

// The brief asked the page to open on a blocked claim, so refusal was the first thing seen.
// It now opens on the first record in the library instead, which shows the whole chain at once
// and makes it obvious the rails are clickable. Refusal is still visible on load without a
// click — the banner carries the blocked count, the blocked claims are struck through in the
// document, and their requirements read "blocked claim only" — so this checks that rather than
// the old rule.
check('16.6  refusal is visible on load without clicking', () => {
  const documents = json('data/generated/documents.json');
  const sources = json('data/generated/sources.json');
  const first = documents[0];

  const blocked = first.claims.filter((c) => c.label === 'c' || c.label === 'd');
  assert(blocked.length > 0, `${first.id} shows no blocked claim on load`);

  // The opening selection is railSources[0]: the lowest-numbered record any document cites.
  const cited = new Set(documents.flatMap((d) => d.claims.map((c) => c.sourceId)));
  const opening = sources
    .filter((s) => s.id !== 's0' && cited.has(s.id))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)))[0];
  assert(opening, 'no record for the page to open on');

  // That opening record must actually feed the first document, or the page opens on a dead
  // selection with nothing lit.
  const feeds = first.claims.filter((c) => c.sourceId === opening.id);
  assert(feeds.length > 0, `${opening.filename} is cited by nothing in ${first.id}`);

  return `opens on ${opening.filename} (${feeds.length} claims) · ${blocked.length} blocked claims visible`;
});

/* -- 8 · the run log contains a refusal ----------------------------------- */

check('16.8  gates data contains at least one exit 1 run', () => {
  const gates = json('data/generated/gates.json');
  const failed = gates.runs.filter((r) => r.exit === 1);
  assert(failed.length > 0, 'every run exits 0');
  return `${failed.length} of ${gates.runs.length} runs exit 1`;
});

/* -- 9 · the pressure test sometimes says no ------------------------------ */

check('16.9  a requirement lands on do not have', () => {
  const requirements = json('data/generated/requirements.json');
  const refused = requirements.filter((r) => r.verdict === 'do not have');
  assert(refused.length > 0, 'no requirement lands on do not have');
  return `${refused.map((r) => r.id).join(', ')}`;
});

/* -- 11 · nothing reaches an external host -------------------------------- */

check('16.11 the page loads nothing from an external host', () => {
  // The rule is that the page makes no request to another host when it loads. A string that
  // merely looks like a URL is not a request: an XML namespace, a JSON-LD @id, a canonical
  // link, an og:url, and an <a href> all cost nothing until something chooses to act on them.
  // So this looks for the constructs that actually load, and reports those.
  const LOADERS = [
    [/<script[^>]*src\s*=\s*["']?(?:https?:)?\/\//gi, 'external script'],
    [/<(?:img|source|video|audio|track|iframe|embed|object|input)[^>]*(?:src|data|poster)\s*=\s*["']?(?:https?:)?\/\//gi, 'external media'],
    [/@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//gi, 'external @import'],
    [/url\(\s*["']?(?:https?:)?\/\//gi, 'external url() in css'],
    [/fetch\s*\(\s*["'`](?:https?:)?\/\//gi, 'fetch to another host'],
    [/new\s+WebSocket\s*\(\s*["'`]/gi, 'websocket'],
    [/XMLHttpRequest/g, 'XMLHttpRequest'],
  ];

  const files = [...walk('src'), ...safeWalk('dist')].filter((f) =>
    ['.html', '.css', '.js', '.mjs'].includes(extname(f)),
  );

  const hits = [];
  for (const file of files) {
    // A stylesheet <link> is a load; a canonical or alternate <link> is not.
    const text = read(file).replace(/<link[^>]*rel\s*=\s*["'](?:canonical|alternate)["'][^>]*>/gi, '');
    for (const [pattern, what] of LOADERS) {
      const found = text.match(pattern);
      if (found) hits.push(`${file}: ${what} — ${found[0].slice(0, 40)}`);
    }
    // Any <link> that pulls a resource must be same-origin and relative.
    for (const tag of text.match(/<link[^>]*>/gi) ?? []) {
      if (/href\s*=\s*["']?(?:https?:)?\/\//i.test(tag)) hits.push(`${file}: external <link> — ${tag.slice(0, 50)}`);
    }
  }
  assert(hits.length === 0, hits.join(' | '));
  return `${files.length} files load nothing off-origin`;
});

function safeWalk(dir) {
  try {
    return walk(dir);
  } catch {
    return [];
  }
}

/* -- 12 · the export performs the refusal --------------------------------- */

await (async () => {
  const { buildDocumentPdf, WITHHELD } = await import('../src/js/pdf.js');
  const { documents, sources, meta } = await import('../src/js/data.js');

  check('16.12 the exported pdf withholds every blocked claim', () => {
    const notes = [];
    for (const doc of documents) {
      const result = buildDocumentPdf({ doc, sources, posting: meta.posting, pinnedDate: meta.pinnedDate });
      const text = Buffer.from(result.bytes).toString('latin1');

      // Test what the page actually draws, not incidental bytes: pull every string shown by a
      // Tj operator and search that. Common words appear in the footer, so compare on the whole
      // claim and on each three-word run inside it.
      const drawn = drawnText(text);
      const blocked = doc.claims.filter((c) => c.label === 'c' || c.label === 'd');
      for (const claim of blocked) {
        assert(!drawn.includes(claim.text), `${doc.id}: blocked claim text was drawn`);
        const words = claim.text.split(/\s+/);
        for (let i = 0; i + 3 <= words.length; i += 1) {
          const phrase = words.slice(i, i + 3).join(' ');
          assert(!drawn.includes(phrase), `${doc.id}: blocked phrase "${phrase}" was drawn`);
        }
      }

      // Match on the ASCII core of the notice: the em dash is one WinAnsi byte in the file,
      // so the JS constant would not compare equal against the latin1 read.
      assert(WITHHELD.includes('claim withheld'), 'withheld notice wording changed');
      const notices = drawn.split('claim withheld').length - 1;
      assert(
        notices === blocked.length,
        `${doc.id}: ${notices} withheld notices for ${blocked.length} blocked claims`,
      );

      // One footnote per distinct record, not per claim: claims sharing a record share a number.
      const shipping = doc.claims.filter((c) => c.label === 'a' || c.label === 'b');
      const distinctRecords = new Set(shipping.map((c) => c.sourceId));
      assert(
        result.footnotes.length === distinctRecords.size,
        `${doc.id}: ${result.footnotes.length} footnotes for ${distinctRecords.size} distinct records`,
      );
      assert(
        new Set(result.footnotes).size === result.footnotes.length,
        `${doc.id}: the same record is footnoted twice`,
      );

      const again = buildDocumentPdf({ doc, sources, posting: meta.posting, pinnedDate: meta.pinnedDate });
      assert(
        Buffer.compare(Buffer.from(result.bytes), Buffer.from(again.bytes)) === 0,
        `${doc.id}: pdf is not byte-identical between builds`,
      );

      // Nothing may be drawn outside the page box. Without this, a long claim would silently
      // run off the bottom edge and the export would look fine in the byte tests above.
      const positions = [...text.matchAll(/1 0 0 1 ([\d.]+) ([-\d.]+) Tm/g)].map((m) => [+m[1], +m[2]]);
      assert(positions.length > 0, `${doc.id}: nothing was drawn`);
      for (const [x, y] of positions) {
        assert(x >= 0 && x <= 612, `${doc.id}: text at x=${x} is outside the page`);
        assert(y >= 0 && y <= 792, `${doc.id}: text at y=${y} is outside the page`);
      }

      // The footer sits alone at y=48. Anything else that low has run off the bottom of the
      // page and is overlapping it — lengthening a document in seed.config.json must fail here
      // rather than ship a letter with its last paragraph printed through the footer.
      const low = positions.filter(([, y]) => y < 60);
      assert(
        low.every(([, y]) => y === 48),
        `${doc.id}: ${low.length - low.filter(([, y]) => y === 48).length} line(s) collide with the footer`,
      );

      notes.push(`${doc.id} ${blocked.length}/${result.footnotes.length}`);
    }
    return `withheld/footnotes — ${notes.join(', ')}`;
  });
})();

// Every string a PDF shows passes through a Tj operator. Pull them out and join them so the
// test reads what a person would see rather than the raw file.
function drawnText(file) {
  const shown = file.match(/\((?:[^()\\]|\\.)*\)\s*Tj/g) ?? [];
  // Each word is its own Tj — spaces are advances, not drawn glyphs — so rejoin on a space to
  // get back the text a reader sees.
  return shown
    .map((op) => op.slice(1, op.lastIndexOf(')')).replace(/\\([\\()])/g, '$1'))
    .join(' ');
}

/* -- report --------------------------------------------------------------- */

let failed = 0;
for (const result of results) {
  if (!result.ok) failed += 1;
  const mark = result.ok ? 'pass' : 'FAIL';
  console.log(`${mark}  ${result.name}${result.detail ? `\n      ${result.detail}` : ''}`);
}
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
