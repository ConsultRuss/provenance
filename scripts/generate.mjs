// Seed generator for the provenance demo.
//
// Reads data/seed.config.json and writes:
//   data/generated/sources.json
//   data/generated/requirements.json
//   data/generated/documents.json
//   data/generated/gates.json
//   src/js/data.js            (the same objects as an ES module, so the page never fetches)
//
// Determinism is a hard requirement: a fixed seed must produce byte-identical output.
// There is no Date.now(), no Math.random(), no locale-dependent formatting anywhere below.
// Every number the page shows is derived from this output and re-asserted at the bottom.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(ROOT, 'data/seed.config.json'), 'utf8'));

/* ---------------------------------------------------------------- prng --- */

// mulberry32: small, fast, and stable across Node versions.
function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = makeRandom(config.seed);
const pick = (list) => list[Math.floor(random() * list.length)];
const between = (lo, hi) => lo + Math.floor(random() * (hi - lo + 1));

// Thousands separators by hand. Intl output depends on the ICU build Node was compiled with,
// which would make the seed output machine-dependent.
const grouped = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* ------------------------------------------------------------- sources --- */

const EXTENSION = {
  'plain text': '.txt',
  'csv export': '.csv',
  pdf: '.pdf',
  json: '.json',
};

function generatedMeta(kind) {
  if (kind === 'plain text') return `transcript · ${grouped(between(1120, 5940))} words`;
  if (kind === 'csv export') return `tabular · ${grouped(between(87, 2310))} rows`;
  if (kind === 'pdf') return `document · ${between(1, 9)} pages`;
  return `structured · ${between(3, 84)} KB`;
}

function generatedExcerpt(kind, topic, stamp) {
  if (kind === 'csv export') {
    return `field,value,recorded\n${topic},${between(11, 989)},${stamp}\n… ${between(13, 217)} more rows`;
  }
  if (kind === 'json') {
    return `{\n  "record": "${topic}",\n  "recorded": "${stamp}",\n  "entries": ${between(7, 431)}\n}`;
  }
  if (kind === 'pdf') {
    return `Filed ${stamp}. Reference ${topic.toUpperCase()}-${between(1004, 9987)}.\nRetained for the parcel file.`;
  }
  return `Recorded ${stamp}.\nNotes filed under ${topic}. ${between(3, 47)} items logged.`;
}

// Four authored sources, then one generated source per topic word.
// The pool size must equal corpusTargets.sourcesCited.
const sources = [...config.sources.map((s) => ({ ...s }))];
config.sourceWords.topic.forEach((topic, i) => {
  const kind = pick(config.sourceKinds);
  const stamp = pick(config.sourceWords.stamp);
  sources.push({
    id: `s${sources.length + 1}`,
    filename: `${topic}_${stamp}${EXTENSION[kind]}`,
    kind,
    meta: generatedMeta(kind),
    excerpt: generatedExcerpt(kind, topic, stamp),
  });
});
// The null source sorts last: it is not a record, it is the absence of one.
sources.push({ ...config.nullSource });

const realSourceIds = sources.filter((s) => s.id !== 's0').map((s) => s.id);

/* -------------------------------------------------- requirements + docs --- */

const requirements = config.requirements.map((r) => ({ ...r }));

const documents = config.documents.map((d) => ({
  id: d.id,
  label: d.label,
  kind: d.kind,
  blocks: d.blocks.map((b) => ({ ...b })),
  claims: d.claims.map((c) => ({ ...c })),
}));

const BLOCK_TYPES = new Set(['meta', 'name', 'contact', 'section', 'role', 'para', 'bullet', 'sig']);
const slotsIn = (doc) =>
  doc.blocks.flatMap((b) => [...(b.text ?? '').matchAll(/\{\{(c\d+)\}\}/g)].map((m) => m[1]));

// The invariant the whole page rests on. A claim that cannot ship has no source.
for (const doc of documents) {
  const slots = slotsIn(doc);
  for (const block of doc.blocks) {
    if (!BLOCK_TYPES.has(block.type)) throw new Error(`${doc.id}: unknown block type ${block.type}`);
  }
  for (const slot of slots) {
    if (!doc.claims.some((c) => c.id === slot)) throw new Error(`${doc.id}: slot ${slot} has no claim`);
  }

  for (const claim of doc.claims) {
    const blocked = claim.label === 'c' || claim.label === 'd';
    if (blocked && claim.sourceId !== 's0') {
      throw new Error(`${doc.id}/${claim.id}: label ${claim.label} must carry sourceId s0, found ${claim.sourceId}`);
    }
    if (!blocked && claim.sourceId === 's0') {
      throw new Error(`${doc.id}/${claim.id}: label ${claim.label} ships, so it may not cite the null source`);
    }
    if (!sources.some((s) => s.id === claim.sourceId)) {
      throw new Error(`${doc.id}/${claim.id}: unknown sourceId ${claim.sourceId}`);
    }
    if (!requirements.some((r) => r.id === claim.requirementId)) {
      throw new Error(`${doc.id}/${claim.id}: unknown requirementId ${claim.requirementId}`);
    }
    if (!slots.includes(claim.id)) {
      throw new Error(`${doc.id}: no block has a slot for ${claim.id}`);
    }
  }
}

/* --------------------------------------------------------------- gates --- */

const gates = config.gates.map((g) => ({ ...g }));
const GATE_IDS = gates.map((g) => g.id);

// How each of the 13 non-focus records ends. The focus record is added separately.
// Ordering here is fixed, so the funnel numbers are reproducible by hand.
const STOPS = [
  'intake', 'intake',
  'live', 'live',
  'pressure', 'pressure',
  'wildcard',
  'lint', 'lint', 'lint',
  null, null, null, // null = reached submitted
];

const STOP_VERDICT = {
  intake: 'fail',
  live: 'expired',
  pressure: 'blocked',
  wildcard: 'blocked',
  lint: 'blocked',
};

function verdictsFor(stopGate) {
  const out = {};
  let stopped = false;
  for (const id of GATE_IDS) {
    if (stopped) {
      out[id] = 'not applicable';
    } else if (id === stopGate) {
      out[id] = STOP_VERDICT[id];
      stopped = true;
    } else {
      out[id] = 'pass';
    }
  }
  return out;
}

// Unique invented company names.
const usedCompanies = new Set([config.posting.company]);
function inventCompany() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const name = `${pick(config.companyWords.first)} ${pick(config.companyWords.second)}`;
    if (!usedCompanies.has(name)) {
      usedCompanies.add(name);
      return name;
    }
  }
  throw new Error('ran out of unique company names; widen companyWords');
}

const targets = config.corpusTargets;

// The focus record is the application shown on the Provenance tab. Its numbers are not
// invented: they are counted from documents.json, so the two tabs cannot disagree.
const focusClaims = documents.flatMap((d) => d.claims);
const focusBlocked = focusClaims.filter((c) => c.label === 'c' || c.label === 'd').length;
const focusSourceIds = [...new Set(focusClaims.map((c) => c.sourceId))].filter((id) => id !== 's0');

// It carries claims labelled c and d, so asset lint stops it. That is the point of the demo.
const focusRecord = {
  id: 'rec-07',
  company: config.posting.company,
  role: config.posting.role,
  focus: true,
  claimsParsed: focusClaims.length,
  claimsCleared: focusClaims.length - focusBlocked,
  claimsBlocked: focusBlocked,
  sourceIds: focusSourceIds,
  stoppedAt: 'lint',
  verdicts: verdictsFor('lint'),
};

// Split the remaining claim budget across the other records: every record gets at least one,
// the remainder is distributed by weight, and the residual is corrected so the total is exact.
const otherCount = targets.records - 1;
const remainingParsed = targets.claimsParsed - focusRecord.claimsParsed;
const remainingBlocked = targets.claimsBlocked - focusRecord.claimsBlocked;

const weights = Array.from({ length: otherCount }, () => 0.35 + random());
const weightTotal = weights.reduce((a, b) => a + b, 0);
const spare = remainingParsed - otherCount;
const parsedCounts = weights.map((w) => 1 + Math.floor((w / weightTotal) * spare));
let residual = remainingParsed - parsedCounts.reduce((a, b) => a + b, 0);
for (let i = 0; residual > 0; i = (i + 1) % otherCount, residual -= 1) parsedCounts[i] += 1;

// Blocked claims belong only to records that asset lint stopped — that is what lint rejects.
const lintIndexes = STOPS.map((s, i) => (s === 'lint' ? i : -1)).filter((i) => i >= 0);
const blockedCounts = new Array(otherCount).fill(0);
for (let n = 0; n < remainingBlocked; n += 1) {
  blockedCounts[lintIndexes[n % lintIndexes.length]] += 1;
}

// A record cannot block more claims than it parsed, and a lint-stopped record must still
// ship something. Borrow from whichever record is currently largest; the total stays exact.
for (const i of lintIndexes) {
  while (parsedCounts[i] < blockedCounts[i] + 1) {
    const donor = parsedCounts.indexOf(Math.max(...parsedCounts));
    if (donor === i || parsedCounts[donor] <= blockedCounts[donor] + 1) {
      throw new Error('cannot balance claim counts; raise claimsParsed or lower claimsBlocked');
    }
    parsedCounts[donor] -= 1;
    parsedCounts[i] += 1;
  }
}

// Every source in the pool must be cited by something, or "23 sources cited" is not true.
const unassigned = realSourceIds.filter((id) => !focusSourceIds.includes(id));

const records = [];
for (let i = 0; i < otherCount; i += 1) {
  const mine = unassigned.filter((_, k) => k % otherCount === i);
  const extra = random() < 0.4 ? [pick(focusSourceIds)] : [];
  const sourceIds = [...new Set([...mine, ...extra])].sort(
    (a, b) => Number(a.slice(1)) - Number(b.slice(1)),
  );
  const stoppedAt = STOPS[i];
  records.push({
    id: `rec-${String(i + 1).padStart(2, '0')}`,
    company: inventCompany(),
    role: pick(config.roleWords),
    focus: false,
    claimsParsed: parsedCounts[i],
    claimsCleared: parsedCounts[i] - blockedCounts[i],
    claimsBlocked: blockedCounts[i],
    sourceIds,
    stoppedAt,
    verdicts: verdictsFor(stoppedAt),
  });
}
records.splice(6, 0, focusRecord);
records.forEach((r, i) => {
  r.id = r.focus ? 'rec-07' : `rec-${String(i + 1).padStart(2, '0')}`;
});

/* ----------------------------------------------------------------- runs --- */

function runLines(record) {
  const lines = [];
  for (const gate of gates) {
    const verdict = record.verdicts[gate.id];
    if (verdict === 'not applicable') break;
    const ok = verdict === 'pass';
    let text;
    if (gate.id === 'intake') {
      text = ok
        ? `${requirements.length} requirements quoted verbatim`
        : 'no verbatim requirement text found in posting';
    } else if (gate.id === 'live') {
      text = ok ? `posting live, rechecked ${config.pinnedDate}` : 'posting closed since intake';
    } else if (gate.id === 'pressure') {
      text = ok ? 'stretch — 1 must-have adjacent but honest' : 'must-have requirement lands on do not have';
    } else if (gate.id === 'wildcard') {
      text = ok ? 'answer drafted from interview_2026-03-11.txt' : 'no honest answer available';
    } else if (gate.id === 'lint') {
      text = ok
        ? `${record.claimsParsed} claims, all labelled a or b`
        : `${record.claimsBlocked} claim(s) labelled c or d`;
    } else {
      text = `${record.claimsCleared} claims shipped`;
    }
    lines.push({ gate: gate.id, status: ok ? 'ok' : verdict.toUpperCase(), text });
  }
  return lines;
}

const runs = records.map((record, i) => ({
  id: `run-${String(i + 1).padStart(4, '0')}`,
  recordId: record.id,
  company: record.company,
  role: record.role,
  lines: runLines(record),
  exit: record.stoppedAt === null ? 0 : 1,
}));

const gatesFile = { gates, records, runs };

/* -------------------------------------------------- assert, then write --- */

const sum = (list, key) => list.reduce((a, r) => a + r[key], 0);
const distinctSources = new Set(records.flatMap((r) => r.sourceIds));

const assertions = [
  ['records', records.length, targets.records],
  ['claimsParsed', sum(records, 'claimsParsed'), targets.claimsParsed],
  ['claimsCleared', sum(records, 'claimsCleared'), targets.claimsCleared],
  ['claimsBlocked', sum(records, 'claimsBlocked'), targets.claimsBlocked],
  ['sourcesCited', distinctSources.size, targets.sourcesCited],
  ['sourcePool', realSourceIds.length, targets.sourcesCited],
];
for (const [name, actual, expected] of assertions) {
  if (actual !== expected) throw new Error(`corpus ${name}: got ${actual}, config says ${expected}`);
}
if (!runs.some((r) => r.exit === 1)) throw new Error('no run exits 1; the log must show a refusal');
if (!requirements.some((r) => r.verdict === 'do not have')) {
  throw new Error('no requirement lands on do not have; the pressure test must sometimes say no');
}

function writeJson(relative, value) {
  const path = join(ROOT, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return relative;
}

writeJson('data/generated/sources.json', sources);
writeJson('data/generated/requirements.json', requirements);
writeJson('data/generated/documents.json', documents);
writeJson('data/generated/gates.json', gatesFile);

// The page imports this instead of fetching the JSON above. Same data, no network, and it
// works from file:// and from any deploy subpath.
const module = `// Generated by scripts/generate.mjs. Do not edit by hand — run: npm run seed
export const sources = ${JSON.stringify(sources, null, 2)};

export const requirements = ${JSON.stringify(requirements, null, 2)};

export const documents = ${JSON.stringify(documents, null, 2)};

export const gates = ${JSON.stringify(gatesFile, null, 2)};

export const meta = ${JSON.stringify(
  { pinnedDate: config.pinnedDate, posting: config.posting, targets },
  null,
  2,
)};
`;
writeFileSync(join(ROOT, 'src/js/data.js'), module, 'utf8');

console.log(`seed ${config.seed} · ${records.length} records · ${targets.claimsParsed} claims parsed · ` +
  `${targets.claimsBlocked} blocked · ${targets.sourcesCited} sources cited`);
console.log('wrote data/generated/*.json and src/js/data.js');
