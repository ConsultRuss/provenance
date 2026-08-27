// View 3 — Pressure test. A decision document, not a second wire diagram.
//
// The overall call is derived from the rows rather than stored, so the headline cannot drift
// away from the evidence underneath it.

import { requirements, meta } from './data.js?v=8fe5df75';
import { el } from './dom.js?v=8fe5df75';

const VERDICT_CLASS = {
  'have as documented': 'have',
  'adjacent but honest': 'adjacent',
  'do not have': 'donot',
};

export function overallCall(rows = requirements) {
  const missingMust = rows.some((r) => r.priority === 'must' && r.verdict === 'do not have');
  if (missingMust) {
    return {
      call: 'do not apply',
      why: 'A must-have requirement lands on do not have. Nothing in the evidence closes that gap.',
    };
  }

  const softMust = rows.some((r) => r.priority === 'must' && r.verdict === 'adjacent but honest');
  const missingPreferred = rows.some((r) => r.priority === 'preferred' && r.verdict === 'do not have');
  if (softMust || missingPreferred) {
    return {
      call: 'stretch',
      why: 'Every must-have is met or adjacent, and the gaps are in preferred requirements. Apply, and say plainly where the evidence stops.',
    };
  }

  return { call: 'apply as posted', why: 'Every requirement is met by a record on file.' };
}

export function mountPressure(root) {
  const { call, why } = overallCall();

  const head = el(
    'div',
    { class: 'call' },
    el('div', { class: 'clab', text: `${meta.posting.company} · ${meta.posting.role}` }),
    el('div', { class: 'cval', text: call }),
    el('div', { class: 'cwhy', text: why }),
  );

  const table = el(
    'table',
    { class: 'grid' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { text: 'requirement', style: 'width:22%' }),
        el('th', { text: 'priority', style: 'width:10%' }),
        el('th', { text: 'evidence' }),
        el('th', { text: 'verdict', style: 'width:17%' }),
      ),
    ),
    el(
      'tbody',
      {},
      requirements.map((requirement) =>
        el(
          'tr',
          {},
          el('td', { text: requirement.title }),
          el('td', {}, el('span', { class: `pill ${requirement.priority}`, text: requirement.priority })),
          el('td', { class: 'ev', text: requirement.evidence }),
          el('td', {}, el('span', { class: `vd ${VERDICT_CLASS[requirement.verdict]}`, text: requirement.verdict })),
        ),
      ),
    ),
  );

  const intro = el(
    'div',
    { class: 'lede-pair' },
    el('p', {
      class: 'lede',
      text:
        'Before a single document is written, the candidate is scored against the posting one ' +
        'requirement at a time, and the answer is written down. This is the step most job search ' +
        'advice skips: deciding honestly whether to apply at all.',
    }),
    el('p', {
      class: 'lede',
      text:
        'Three verdicts are allowed. Have as documented means a record proves it. Adjacent but ' +
        'honest means the real experience is close but not the same, and the difference gets said ' +
        'out loud rather than rounded up. Do not have means exactly that. The call at the top is ' +
        'worked out from the rows below it, so it cannot flatter them.',
    }),
  );

  root.append(
    intro,
    head,
    table,
    el('p', {
      class: 'foot',
      text: 'The verdict column is written before the documents are generated. A claim the pressure test will not credit cannot become evidence later.',
    }),
  );
}
