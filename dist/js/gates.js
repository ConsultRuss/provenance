// View 2 — Gates. The funnel and the run log.
//
// Most pipelines count throughput. This one counts refusals, so the number of records stopped
// is the headline on every card and in the summary line above them.

import { gates } from './data.js';
import { el } from './dom.js';

const REJECTED = new Set(['fail', 'blocked', 'expired']);

function tally(gateId) {
  const counts = { pass: 0, blocked: 0, expired: 0, fail: 0, 'not applicable': 0 };
  for (const record of gates.records) {
    const verdict = record.verdicts[gateId];
    if (verdict in counts) counts[verdict] += 1;
  }
  return counts;
}

// Pad in the monospace log so columns line up without a table.
const pad = (text, width) => (text.length >= width ? text : text + ' '.repeat(width - text.length));

// The log names each gate exactly as the card above it does.
const LABEL_BY_ID = new Map(gates.gates.map((g) => [g.id, g.label]));
const gateLabel = (id) => LABEL_BY_ID.get(id) ?? id;

export function mountGates(root) {
  const totals = gates.records.reduce(
    (acc, record) => {
      if (record.stoppedAt) acc.refused += 1;
      else acc.submitted += 1;
      return acc;
    },
    { refused: 0, submitted: 0 },
  );

  const summary = el(
    'div',
    { class: 'bar' },
    el('div', {
      class: 'bar-t',
      text: 'A record only reaches submitted if every gate before it passes. Refusal is the normal outcome.',
    }),
    el('div', {
      class: 'bar-n',
      text: `${totals.refused} refused · ${totals.submitted} submitted · ${gates.records.length} records`,
    }),
  );

  const funnel = el(
    'div',
    { class: 'funnel' },
    gates.gates.map((gate) => {
      const counts = tally(gate.id);
      const rejected = counts.fail + counts.blocked + counts.expired;
      // Each gate stops records with exactly one verdict, so name the one it uses.
      const verdictName =
        counts.blocked > 0 ? 'blocked' : counts.expired > 0 ? 'expired' : counts.fail > 0 ? 'failed' : 'blocked';

      return el(
        'div',
        { class: 'gate' },
        el('div', { class: 'gname', text: gate.label }),
        el('div', { class: `gbig${rejected === 0 ? ' zero' : ''}`, text: String(rejected) }),
        el('div', { class: 'glab', text: verdictName }),
        el(
          'div',
          { class: 'grow', style: 'margin-top:8px' },
          el('span', { text: 'passed' }),
          el('span', { text: String(counts.pass) }),
        ),
        el(
          'div',
          { class: 'grow' },
          el('span', { text: 'not reached' }),
          el('span', { text: String(counts['not applicable']) }),
        ),
        el('div', { class: 'grej', text: `rejects ${gate.rejects}` }),
      );
    }),
  );

  const log = el(
    'div',
    { class: 'log' },
    gates.runs.map((run) =>
      el(
        'div',
        { class: 'run' },
        el('div', { class: 'rhead ln', text: `$ run ${run.recordId} · ${run.company} · ${run.role}` }),
        run.lines.map((line) =>
          el(
            'div',
            { class: 'ln' },
            document.createTextNode(`  ${pad(gateLabel(line.gate), 18)} `),
            el('span', {
              class: line.status === 'ok' ? 'ok' : 'bad',
              text: pad(line.status, 9),
            }),
            document.createTextNode(line.text),
          ),
        ),
        el('div', { class: `ln exit${run.exit}`, text: `exit ${run.exit}` }),
      ),
    ),
  );

  root.append(
    summary,
    funnel,
    el('p', {
      class: 'foot',
      text: 'The number on each card is how many records that gate stopped. Passed records move right.',
    }),
    el('h2', { text: 'run log', style: 'margin-top:26px' }),
    log,
  );
}
