// View 1 — Provenance. The three-column chain.
//
// Behaviour follows design/provenance-mock.html. Three things are deliberately different:
//   1. The counter is computed from the claims, never hardcoded.
//   2. The metric cards read the whole generated corpus and say so.
//   3. Claims and rail rows are real buttons, so the keyboard works without extra handlers.

import { sources, requirements, documents, gates, meta } from './data.js';
import { drawWires, onLayoutChange } from './wires.js';
import { buildDocumentPdf } from './pdf.js';
import { el, clear } from './dom.js';

const LABELS = {
  a: { meaning: 'said directly', color: 'var(--ok)' },
  b: { meaning: 'confirmed against a record', color: 'var(--ac)' },
  c: { meaning: 'asserted, never confirmed', color: 'var(--wn)' },
  d: { meaning: 'derived document only', color: 'var(--dg)' },
};

const isBlocked = (claim) => claim.label === 'c' || claim.label === 'd';
const sourceById = new Map(sources.map((s) => [s.id, s]));
const requirementById = new Map(requirements.map((r) => [r.id, r]));

// The rails never change when the document changes. This is the union of everything the three
// documents cite, so one source pool visibly feeds several outputs.
const railSources = (() => {
  const cited = new Set(documents.flatMap((d) => d.claims.map((c) => c.sourceId)));
  const real = [...cited].filter((id) => id !== 's0').sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return [...real, ...(cited.has('s0') ? ['s0'] : [])].map((id) => sourceById.get(id));
})();

/* ---------------------------------------------------------------- corpus --- */

const corpus = {
  parsed: gates.records.reduce((n, r) => n + r.claimsParsed, 0),
  cleared: gates.records.reduce((n, r) => n + r.claimsCleared, 0),
  blocked: gates.records.reduce((n, r) => n + r.claimsBlocked, 0),
  sources: new Set(gates.records.flatMap((r) => r.sourceIds)).size,
  records: gates.records.length,
};

/* ------------------------------------------------------------ derivation --- */

// Requirement state for one document: answered if any claim that ships answers it, blocked if
// only blocked claims answer it, unanswered if nothing does.
function requirementStates(doc) {
  const state = new Map(requirements.map((r) => [r.id, 'unanswered']));
  for (const claim of doc.claims) {
    if (state.get(claim.requirementId) === 'answered') continue;
    state.set(claim.requirementId, isBlocked(claim) ? 'blocked' : 'answered');
  }
  return state;
}

function counterText(doc) {
  const state = requirementStates(doc);
  const values = [...state.values()];
  const answered = values.filter((v) => v === 'answered').length;
  const blocked = values.filter((v) => v === 'blocked').length;
  const unanswered = values.filter((v) => v === 'unanswered').length;
  const tail = blocked > 0 ? `${blocked} blocked` : `${unanswered} unanswered`;
  return `answers ${answered} of ${requirements.length} · ${tail}`;
}

/* ------------------------------------------------------------------ view --- */

export function mountProvenance(root) {
  let currentDoc = documents[0];
  let selectedClaimId = null;

  const srail = el('div', { class: 'rail', id: 'srail' });
  const rrail = el('div', { class: 'rail', id: 'rrail' });
  const docBox = el('div', { class: 'doc' });
  const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wires.setAttribute('id', 'wires');
  wires.setAttribute('aria-hidden', 'true');
  wires.setAttribute('focusable', 'false');

  const chain = el(
    'div',
    { class: 'chain' },
    wires,
    el('div', {}, el('div', { class: 'railh', text: 'source records' }), srail),
    el('div', {}, el('div', { class: 'railh', text: 'generated document' }), docBox),
    el(
      'div',
      {},
      el('div', {
        class: 'railh',
        text: `job requirements — ${meta.posting.company}, ${meta.posting.role}`,
      }),
      rrail,
    ),
  );

  const inspector = el('div', {
    class: 'insp',
    'aria-live': 'polite',
    role: 'region',
    'aria-label': 'inspector',
  });

  const counter = el('div', { class: 'cnt' });
  const docButtons = new Map();
  const claimButtons = new Map();
  const sourceRows = new Map();
  const requirementRows = new Map();

  /* ------------------------------------------------------------- header --- */

  const banner = el(
    'div',
    { class: 'bar' },
    el('div', { class: 'bar-t', text: 'Labels c and d cannot ship. The generator refuses to emit them.' }),
    el('div', { class: 'bar-n', text: `${corpus.blocked} claims blocked · all runs` }),
  );

  const stat = (label, value, bad) =>
    el(
      'div',
      { class: 'stat' },
      el('div', { class: 'l', text: label }),
      el('div', { class: `v${bad ? ' bad' : ''}`, text: String(value) }),
    );

  const stats = el(
    'div',
    { class: 'stats' },
    stat('claims parsed', corpus.parsed),
    stat('cleared', corpus.cleared),
    stat('claims blocked', corpus.blocked, true),
    stat('sources cited', corpus.sources),
  );

  const statsNote = el('div', {
    class: 'stats-note',
    text: `across ${corpus.records} runs in the generated corpus · the document below is one of them`,
  });

  const legend = el(
    'div',
    { class: 'lgd' },
    Object.entries(LABELS).map(([key, value]) =>
      el('span', { class: 'lg' }, el('span', { class: `kx ${key}`, text: key }), document.createTextNode(value.meaning)),
    ),
  );

  /* ------------------------------------------------------------- toggle --- */

  const download = el('button', {
    class: 'dl',
    type: 'button',
    text: 'download as pdf',
    onclick: () => exportCurrent(),
  });

  const toggle = el(
    'div',
    { class: 'tgl' },
    documents.map((doc) => {
      const button = el('button', {
        class: 'tb',
        type: 'button',
        'aria-pressed': doc === currentDoc ? 'true' : 'false',
        text: doc.label,
        onclick: () => setDocument(doc),
      });
      docButtons.set(doc.id, button);
      return button;
    }),
    download,
    counter,
  );

  /* --------------------------------------------------------------- rails --- */

  for (const source of railSources) {
    const row = el(
      'button',
      {
        class: 'rw',
        type: 'button',
        'aria-pressed': 'false',
        onclick: () => showSource(source.id),
      },
      el('div', { class: `fn${source.id === 's0' ? ' none' : ''}`, text: source.filename }),
      el('div', { class: 'mt', text: source.meta }),
    );
    sourceRows.set(source.id, row);
    srail.append(row);
  }

  for (const requirement of requirements) {
    const dot = el('span', { class: 'dot' });
    const state = el('span', { class: 'st' });
    const row = el(
      'button',
      {
        class: 'rw',
        type: 'button',
        'aria-pressed': 'false',
        onclick: () => showRequirement(requirement.id),
      },
      el('div', { class: 'rq' }, dot, document.createTextNode(requirement.title)),
      el(
        'div',
        { class: 'mt', style: 'margin-top:5px' },
        el('span', { class: `pill ${requirement.priority}`, text: requirement.priority }),
        document.createTextNode(' '),
        state,
      ),
    );
    requirementRows.set(requirement.id, { row, dot, state });
    rrail.append(row);
  }

  /* ------------------------------------------------------------ document --- */

  function renderDocument() {
    clear(docBox);
    claimButtons.clear();
    docBox.className = `doc${currentDoc.kind === 'bullets' ? ' bullets' : ''}`;

    const claimById = new Map(currentDoc.claims.map((c) => [c.id, c]));

    for (const lineText of currentDoc.template.split('\n')) {
      const line = currentDoc.kind === 'bullets' ? el('div', {}) : docBox;
      if (currentDoc.kind === 'bullets') line.append(document.createTextNode('· '));

      for (const part of lineText.split(/(\{\{c\d+\}\})/)) {
        if (part === '') continue;
        const match = part.match(/^\{\{(c\d+)\}\}$/);
        if (!match) {
          line.append(document.createTextNode(part));
          continue;
        }
        const claim = claimById.get(match[1]);
        if (!claim) continue;

        const blocked = isBlocked(claim);
        const button = el('button', {
          class: `cl ${claim.label}${blocked ? ' blk' : ''}`,
          type: 'button',
          'aria-pressed': 'false',
          'aria-label': `claim: ${claim.text}. label ${claim.label}, ${
            blocked ? 'blocked from output' : 'ships'
          }.`,
          text: claim.text,
          onclick: () => showClaim(claim.id),
        });
        claimButtons.set(claim.id, button);
        line.append(button);
      }

      if (currentDoc.kind === 'bullets') docBox.append(line);
    }
  }

  function paintRequirementStates() {
    const state = requirementStates(currentDoc);
    for (const requirement of requirements) {
      const { dot, state: label } = requirementRows.get(requirement.id);
      const value = state.get(requirement.id);
      dot.className = `dot ${value === 'answered' ? 'answered' : value === 'blocked' ? 'blocked' : ''}`.trim();
      label.className = `st ${value === 'blocked' ? 'blocked' : value}`;
      label.textContent =
        value === 'answered' ? 'answered' : value === 'blocked' ? 'blocked claim only' : 'unanswered';
    }
  }

  /* --------------------------------------------------------------- wires --- */

  function links() {
    return currentDoc.claims
      .map((claim) => {
        const claimEl = claimButtons.get(claim.id);
        const requirementEl = requirementRows.get(claim.requirementId)?.row;
        if (!claimEl || !requirementEl) return null;
        const blocked = isBlocked(claim);
        return {
          key: claim.id,
          claim: claimEl,
          // A blocked claim has no record behind it, so it has no left wire.
          source: blocked ? null : sourceRows.get(claim.sourceId) ?? null,
          requirement: requirementEl,
          blocked,
          color: blocked ? 'var(--dg)' : LABELS[claim.label].color,
        };
      })
      .filter(Boolean);
  }

  const redraw = () => drawWires(wires, chain, links(), selectedClaimId);

  /* ----------------------------------------------------------- selection --- */

  function clearPressed() {
    for (const row of sourceRows.values()) row.setAttribute('aria-pressed', 'false');
    for (const { row } of requirementRows.values()) row.setAttribute('aria-pressed', 'false');
    for (const button of claimButtons.values()) button.setAttribute('aria-pressed', 'false');
  }

  function chip(text, blocked, onclick) {
    return el('button', { class: `chip${blocked ? ' blocked' : ''}`, type: 'button', text, onclick });
  }

  function showClaim(claimId) {
    const claim = currentDoc.claims.find((c) => c.id === claimId);
    if (!claim) return;

    selectedClaimId = claimId;
    clearPressed();
    claimButtons.get(claimId)?.setAttribute('aria-pressed', 'true');
    requirementRows.get(claim.requirementId)?.row.setAttribute('aria-pressed', 'true');

    const blocked = isBlocked(claim);
    if (!blocked) sourceRows.get(claim.sourceId)?.setAttribute('aria-pressed', 'true');
    redraw();

    const source = sourceById.get(claim.sourceId);
    const requirement = requirementById.get(claim.requirementId);

    clear(inspector).append(
      el(
        'div',
        { class: 'ihead' },
        el('span', { class: `kx ${claim.label}`, text: claim.label }),
        el('span', { class: 'ikind', text: 'claim' }),
        el('span', {
          class: `verd ${blocked ? 'blocked' : 'ships'}`,
          text: blocked ? 'blocked from output' : 'ships',
        }),
      ),
      el('div', { class: 'iquote', text: `“${claim.text}”` }),
      el(
        'div',
        { class: 'kv' },
        el('div', { class: 'k', text: 'label' }),
        el('div', { text: LABELS[claim.label].meaning }),
        el('div', { class: 'k', text: 'source' }),
        el('div', {}, chip(source.filename, blocked, () => showSource(source.id))),
        el('div', { class: 'k', text: 'answers' }),
        el(
          'div',
          {},
          chip(requirement.title, false, () => showRequirement(requirement.id)),
          el('span', { class: 'kv-p', style: 'color:var(--sec);font-size:12.5px', text: ` ${requirement.priority}` }),
        ),
      ),
      el('div', { class: 'code', text: source.excerpt }),
    );
  }

  function showSource(sourceId) {
    selectedClaimId = null;
    clearPressed();
    sourceRows.get(sourceId)?.setAttribute('aria-pressed', 'true');
    redraw();

    const source = sourceById.get(sourceId);
    const citing = currentDoc.claims.filter((c) => c.sourceId === sourceId);

    clear(inspector).append(
      el(
        'div',
        { class: 'ihead' },
        el('span', { class: 'ikind', text: 'source record' }),
        el('span', { class: 'verd plain', text: source.kind }),
      ),
      el('div', { class: 'iname', text: source.filename }),
      el('div', { class: 'imeta', text: source.meta }),
      el('div', { class: 'code', text: source.excerpt }),
      el(
        'div',
        { class: 'kv' },
        el('div', { class: 'k', text: 'cited by' }),
        el(
          'div',
          {},
          citing.length
            ? citing.map((claim) => chip(claim.text, isBlocked(claim), () => showClaim(claim.id)))
            : el('span', { class: 'empty', text: 'no claim in this document draws on it' }),
        ),
      ),
    );
  }

  function showRequirement(requirementId) {
    selectedClaimId = null;
    clearPressed();
    requirementRows.get(requirementId)?.row.setAttribute('aria-pressed', 'true');
    redraw();

    const requirement = requirementById.get(requirementId);
    const answering = currentDoc.claims.filter((c) => c.requirementId === requirementId);

    clear(inspector).append(
      el(
        'div',
        { class: 'ihead' },
        el('span', { class: 'ikind', text: 'job requirement' }),
        el('span', {
          class: `verd ${requirement.priority === 'must' ? 'blocked' : 'plain'}`,
          text: requirement.priority,
        }),
      ),
      el('div', { class: 'iquote', text: requirement.title }),
      el('div', { class: 'code', text: requirement.verbatim }),
      el(
        'div',
        { class: 'kv' },
        el('div', { class: 'k', text: 'answered by' }),
        el(
          'div',
          {},
          answering.length
            ? answering.map((claim) =>
                chip(
                  isBlocked(claim) ? `${claim.text} · blocked` : claim.text,
                  isBlocked(claim),
                  () => showClaim(claim.id),
                ),
              )
            : el('span', { class: 'empty', text: 'nothing in this document answers it' }),
        ),
      ),
    );
  }

  /* ------------------------------------------------------------- export --- */

  function exportCurrent() {
    const result = buildDocumentPdf({
      doc: currentDoc,
      sources,
      posting: meta.posting,
      pinnedDate: meta.pinnedDate,
    });
    const blob = new Blob([result.bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: result.filename });
    document.body.append(link);
    link.click();
    link.remove();
    // Revoke on the next frame so the download has started.
    requestAnimationFrame(() => URL.revokeObjectURL(url));
  }

  /* -------------------------------------------------------------- switch --- */

  function setDocument(doc) {
    currentDoc = doc;
    selectedClaimId = null;
    for (const [id, button] of docButtons) button.setAttribute('aria-pressed', id === doc.id ? 'true' : 'false');
    counter.textContent = counterText(doc);
    renderDocument();
    paintRequirementStates();

    // Open on a blocked claim where one exists. The first thing a visitor sees should be the
    // system refusing to ship something.
    const opening = doc.claims.find(isBlocked) ?? doc.claims[0];
    if (opening) showClaim(opening.id);
    else redraw();
  }

  /* --------------------------------------------------------------- mount --- */

  root.append(
    banner,
    stats,
    statsNote,
    legend,
    toggle,
    chain,
    inspector,
    el('p', {
      class: 'foot',
      text: 'Click a claim to trace it. Click a source or a requirement to inspect it. Blocked claims have no wire on the left.',
    }),
  );

  setDocument(currentDoc);
  onLayoutChange(chain, redraw);

  return { redraw };
}
