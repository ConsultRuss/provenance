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

  const intro = el(
    'div',
    {},
    el('p', {
      class: 'lede',
      text:
        'This is a job search run as a pipeline. Every posting that comes in becomes a record, ' +
        'and a record has to clear six checks in order before anything is sent to an employer. ' +
        'Most records never get that far, and that is the design rather than a fault. A pipeline ' +
        'that sends everything is easy to build. This one is built to stop.',
    }),
    el('p', {
      class: 'lede',
      text:
        'Read the row left to right. Each card is one check: what it looks at, and how many ' +
        'records it stopped. A record stopped at a gate is not retried and not quietly fixed — ' +
        'the work needed to pass that gate honestly is the work that was missing.',
    }),
  );

  const funnel = el(
    'div',
    { class: 'funnel' },
    gates.gates.map((gate, i) => {
      const counts = tally(gate.id);
      const stopped = counts.fail + counts.blocked + counts.expired;
      const reached = gates.records.length - counts['not applicable'];
      // Each gate stops records with exactly one verdict, so name the one it uses.
      const verdictName =
        counts.blocked > 0 ? 'blocked' : counts.expired > 0 ? 'expired' : counts.fail > 0 ? 'failed' : 'stopped';

      return el(
        'div',
        { class: 'gate' },
        el(
          'div',
          { class: 'ghead' },
          el('span', { class: 'gnum', text: String(i + 1) }),
          el('span', { class: 'gname', text: gate.label }),
        ),
        el('div', { class: 'gplain', text: gate.plain }),
        el('div', { class: `gbig${stopped === 0 ? ' zero' : ''}`, text: String(stopped) }),
        el('div', { class: 'glab', text: stopped === 0 ? 'stopped none' : `${verdictName} here` }),
        el(
          'div',
          { class: 'grow', style: 'margin-top:9px' },
          el('span', { text: 'reached' }),
          el('span', { text: String(reached) }),
        ),
        el(
          'div',
          { class: 'grow' },
          el('span', { text: 'passed on' }),
          el('span', { text: String(counts.pass) }),
        ),
      );
    }),
  );

  const rejections = el(
    'dl',
    { class: 'vocab' },
    gates.gates.flatMap((gate) => [
      el('dt', { text: gate.label }),
      el('dd', { text: `rejects ${gate.rejects}` }),
    ]),
  );

  const vocabulary = el(
    'dl',
    { class: 'vocab' },
    [
      ['pass', 'the record met this gate and moved to the next one'],
      ['blocked', 'the gate refused the record on purpose — this is the outcome the pipeline exists to produce'],
      ['expired', 'the posting closed or went stale before the record reached this gate'],
      ['fail', 'the gate could not be run because an input it needs is missing'],
      ['not applicable', 'the record was stopped at an earlier gate and never reached this one'],
    ].flatMap(([term, meaning]) => [
      el('dt', { text: term }),
      el('dd', { text: meaning }),
    ]),
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
    intro,
    funnel,
    el('h2', { text: 'what each gate turns away', style: 'margin-top:28px' }),
    rejections,
    el('h2', { text: 'what each verdict means', style: 'margin-top:28px' }),
    vocabulary,
    el('h2', { text: 'run log', style: 'margin-top:28px' }),
    el('p', {
      class: 'lede',
      text:
        'One block per record, in the order the pipeline processed them. Each line is one gate, ' +
        'with the verdict and the reason it was reached. A run ends exit 0 only if the record ' +
        'cleared every gate and was submitted; exit 1 means a gate stopped it, and the last line ' +
        'before the exit says which one and why.',
    }),
    log,
  );
}
