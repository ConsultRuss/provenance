// View 1 — Provenance. The three-column chain.
//
// Behaviour follows design/provenance-mock.html. Four things are deliberately different:
//   1. The counter is computed from the claims, never hardcoded.
//   2. The metric cards read the whole generated corpus and say so.
//   3. Documents are built from typed blocks, so a letter reads as a letter and a résumé as a
//      résumé rather than as one undifferentiated paragraph.
//   4. Rail rows are real buttons; claims are role="button" spans, because a button cannot
//      flow as inline text (see claimSpan).

import { sources, requirements, documents, gates, meta } from './data.js?v=14459050';
import { drawWires, onLayoutChange } from './wires.js?v=14459050';
import { buildDocumentPdf } from './pdf.js?v=14459050';
import { el, clear } from './dom.js?v=14459050';

const LABELS = {
  a: { meaning: 'the candidate said it', color: 'var(--ok)' },
  b: { meaning: 'a record confirms it', color: 'var(--ac)' },
  c: { meaning: 'claimed, never checked', color: 'var(--wn)' },
  d: { meaning: 'only in an earlier draft', color: 'var(--dg)' },
};

// What kind of record something is decides which label it can support.
const CATEGORY_MEANING = {
  'self-report': 'the subject said it',
  'third-party record': 'someone else attested to it',
  'system export': 'a system produced it',
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

  // What is selected, and therefore which wires are lit. Selecting a claim lights its own pair;
  // selecting a source or a requirement lights every claim that touches it, so the chain through
  // that row is visible in one go rather than one claim at a time.
  let selection = null; // { kind: 'claim' | 'source' | 'requirement', id }

  function selectedClaims() {
    if (!selection) return [];
    if (selection.kind === 'claim') return currentDoc.claims.filter((c) => c.id === selection.id);
    if (selection.kind === 'source') return currentDoc.claims.filter((c) => c.sourceId === selection.id);
    return currentDoc.claims.filter((c) => c.requirementId === selection.id);
  }

  const srail = el('div', { class: 'rail', id: 'srail' });
  const rrail = el('div', { class: 'rail', id: 'rrail' });

  const post = meta.posting;
  const postingCard = el(
    'button',
    {
      class: 'posting',
      type: 'button',
      'aria-pressed': 'false',
      onclick: () => showPosting(),
    },
    el('div', { class: 'p-co', text: post.company }),
    el('div', { class: 'p-role', text: post.role }),
    el(
      'div',
      { class: 'p-meta' },
      el('span', { text: post.location }),
      el('span', { text: post.employment }),
      el('span', { text: post.compensation }),
      el('span', { text: `req ${post.reqId} · closes ${post.closes}` }),
    ),
    el('div', { class: 'p-more', text: 'read the full posting' }),
  );
  const docBox = el('div', { class: 'doc' });
  const wires = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  wires.setAttribute('id', 'wires');
  wires.setAttribute('aria-hidden', 'true');
  wires.setAttribute('focusable', 'false');

  const chain = el(
    'div',
    { class: 'chain' },
    wires,
    el(
      'div',
      {},
      el(
        'div',
        { class: 'railh' },
        document.createTextNode('record library'),
        el('span', { class: 'hint', text: 'click a record' }),
      ),
      srail,
    ),
    el('div', {}, el('div', { class: 'railh', text: 'generated document' }), docBox),
    el(
      'div',
      {},
      el('div', { class: 'railh', text: 'job posting' }),
      postingCard,
      el(
        'div',
        { class: 'railh', style: 'margin-top:16px' },
        document.createTextNode('requirements'),
        el('span', { class: 'hint', text: 'click a requirement' }),
      ),
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
  const claimEls = new Map();
  const sourceRows = new Map();
  const requirementRows = new Map();

  /* ------------------------------------------------------------- header --- */

  const banner = el(
    'div',
    { class: 'bar' },
    el('div', {
      class: 'bar-t',
      text: 'A claim with no record behind it is not sent. Labels c and d never leave this page.',
    }),
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
      source.category !== 'none' &&
        el('div', {}, el('span', { class: `cat ${source.category.replace(/ /g, '-')}`, text: source.category })),
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

  // Claims are spans rather than buttons. A button is coerced to inline-block by every engine,
  // which makes each claim an unbreakable box and forces the prose to break around it. Section
  // 14 allows role="button" with tabindex and explicit Enter/Space, which is what this does.
  function claimSpan(claim) {
    const blocked = isBlocked(claim);
    const span = el('span', {
      class: `cl ${claim.label}${blocked ? ' blk' : ''}`,
      role: 'button',
      tabindex: '0',
      'aria-pressed': 'false',
      'aria-label': `claim: ${claim.text}. label ${claim.label}, ${blocked ? 'blocked from output' : 'ships'}.`,
      text: claim.text,
      onclick: () => showClaim(claim.id),
      onkeydown: (event) => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return;
        event.preventDefault(); // Space would scroll the page
        showClaim(claim.id);
      },
    });
    claimEls.set(claim.id, span);
    return span;
  }

  // Fills {{cN}} slots in one block of text and returns the pieces.
  function fill(text, claimById) {
    const parts = [];
    for (const part of text.split(/(\{\{c\d+\}\})/)) {
      if (part === '') continue;
      const match = part.match(/^\{\{(c\d+)\}\}$/);
      if (!match) parts.push(document.createTextNode(part));
      else {
        const claim = claimById.get(match[1]);
        if (claim) parts.push(claimSpan(claim));
      }
    }
    return parts;
  }

  function renderDocument() {
    clear(docBox);
    claimEls.clear();
    docBox.className = `doc ${currentDoc.kind}`;

    const claimById = new Map(currentDoc.claims.map((c) => [c.id, c]));

    for (const block of currentDoc.blocks) {
      const content = fill(block.text ?? '', claimById);

      if (block.type === 'role') {
        docBox.append(
          el(
            'div',
            { class: 'b-role' },
            el('span', { class: 'b-role-t' }, content),
            el('span', { class: 'b-role-m', text: block.meta ?? '' }),
          ),
        );
      } else if (block.type === 'bullet') {
        docBox.append(el('div', { class: 'b-bullet' }, document.createTextNode('· '), content));
      } else {
        docBox.append(el('div', { class: `b-${block.type}` }, content));
      }
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
        const claimEl = claimEls.get(claim.id);
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

  const redraw = () => drawWires(wires, chain, links(), new Set(selectedClaims().map((c) => c.id)));

  // Light every row the selected claims touch, so a wire always lands on something marked.
  function paintSelection() {
    clearPressed();
    const claims = selectedClaims();
    for (const claim of claims) {
      claimEls.get(claim.id)?.setAttribute('aria-pressed', 'true');
      requirementRows.get(claim.requirementId)?.row.setAttribute('aria-pressed', 'true');
      if (!isBlocked(claim)) sourceRows.get(claim.sourceId)?.setAttribute('aria-pressed', 'true');
    }
    // The clicked row stays marked even when nothing in this document connects to it.
    if (selection?.kind === 'source') sourceRows.get(selection.id)?.setAttribute('aria-pressed', 'true');
    if (selection?.kind === 'requirement') {
      requirementRows.get(selection.id)?.row.setAttribute('aria-pressed', 'true');
    }
    redraw();
  }

  /* ----------------------------------------------------------- selection --- */

  function clearPressed() {
    postingCard.setAttribute('aria-pressed', 'false');
    for (const row of sourceRows.values()) row.setAttribute('aria-pressed', 'false');
    for (const { row } of requirementRows.values()) row.setAttribute('aria-pressed', 'false');
    for (const button of claimEls.values()) button.setAttribute('aria-pressed', 'false');
  }

  function chip(text, blocked, onclick) {
    return el('button', { class: `chip${blocked ? ' blocked' : ''}`, type: 'button', text, onclick });
  }

  function showClaim(claimId) {
    const claim = currentDoc.claims.find((c) => c.id === claimId);
    if (!claim) return;

    selection = { kind: 'claim', id: claimId };
    paintSelection();

    const blocked = isBlocked(claim);
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
    selection = { kind: 'source', id: sourceId };
    paintSelection();

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
      source.category !== 'none' &&
        el(
          'div',
          { class: 'kv' },
          el('div', { class: 'k', text: 'kind' }),
          el(
            'div',
            {},
            el('span', { class: `cat ${source.category.replace(/ /g, '-')}`, text: source.category }),
            el('span', {
              style: 'color:var(--sec);font-size:12.5px',
              text: ` — ${CATEGORY_MEANING[source.category] ?? ''}, so it can carry ${
                source.category === 'self-report' ? 'label a' : 'label b'
              }`,
            }),
          ),
        ),
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

  // The whole posting, as posted. The requirements the pipeline extracted are quoted verbatim
  // underneath it, so a reader can check the extraction against the source text.
  function showPosting() {
    selection = null;
    clearPressed();
    postingCard.setAttribute('aria-pressed', 'true');
    redraw();

    const facts = [
      ['req', post.reqId],
      ['team', `${post.team} · reports to ${post.reportsTo}`],
      ['location', post.location],
      ['type', `${post.employment} · travel ${post.travel}`],
      ['pay', post.compensation],
      ['physical', post.physical],
      ['dates', `posted ${post.posted} · closes ${post.closes}`],
    ].filter(([, value]) => value);

    clear(inspector).append(
      el(
        'div',
        { class: 'ihead' },
        el('span', { class: 'ikind', text: 'job posting' }),
        el('span', { class: 'verd plain', text: post.company }),
      ),
      el('div', { class: 'iquote', text: post.role }),
      el(
        'div',
        { class: 'kv' },
        facts.flatMap(([key, value]) => [el('div', { class: 'k', text: key }), el('div', { text: value })]),
      ),
      el('div', { class: 'code', text: post.blurb }),
      el('h3', { style: 'margin-top:18px', text: 'what the role does' }),
      el('ul', { class: 'plain-list' }, post.responsibilities.map((line) => el('li', { text: line }))),
      el('h3', { style: 'margin-top:16px', text: 'the open question' }),
      el('div', { class: 'code', text: post.wildcard }),
      el('p', {
        class: 'foot',
        text: 'The wildcard gate rejects an application when there is no honest answer to this question.',
      }),
      el('h3', { style: 'margin-top:16px', text: `requirements extracted · ${requirements.length}` }),
      el(
        'div',
        { class: 'req-quotes' },
        requirements.map((r) =>
          el(
            'div',
            { class: 'req-quote' },
            el(
              'div',
              { class: 'rq-head' },
              el('span', { class: `pill ${r.priority}`, text: r.priority }),
              el('span', { class: 'rq-title', text: r.title }),
            ),
            el('div', { class: 'code', text: r.verbatim }),
          ),
        ),
      ),
    );
  }

  function showRequirement(requirementId) {
    selection = { kind: 'requirement', id: requirementId };
    paintSelection();

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
    for (const [id, button] of docButtons) button.setAttribute('aria-pressed', id === doc.id ? 'true' : 'false');
    counter.textContent = counterText(doc);
    renderDocument();
    paintRequirementStates();

    // Open on the first record in the library, so the first thing a visitor sees is a record
    // feeding claims that answer requirements — the whole mechanism in one selection, and a
    // demonstration that the rails are clickable.
    //
    // A claim id means a different claim in each document, so a claim selection cannot survive
    // a document switch. A record or a requirement can, and keeping it is worth more than
    // resetting: the same record stays lit while the document under it changes, which is the
    // point the fixed rails are making.
    if (!selection || selection.kind === 'claim') {
      selection = { kind: 'source', id: railSources[0].id };
    }
    if (selection.kind === 'source') showSource(selection.id);
    else showRequirement(selection.id);
  }

  /* --------------------------------------------------------------- mount --- */

  const orientation = el(
    'div',
    { class: 'orient' },
    el('p', {
      class: 'lede',
      text:
        'Read left to right: everything this candidate can prove something with, a document ' +
        'written for one job, and what that job asked for. Click any underlined claim to follow ' +
        'it to its record and to the requirement it answers. Two claims here have no record at ' +
        'all — the reason this application never went out.',
    }),
    // Shown only where the CSS has hidden the wire layer.
    el('p', {
      class: 'lede narrow-only',
      text:
        'This screen is too narrow for the connecting lines, so they are hidden. Nothing is lost: ' +
        'select any claim, record or requirement and the panel underneath names everything it ' +
        'connects to.',
    }),
  );

  // The readout and the orientation sit on one row. Stacked they cost 204px before the reader
  // reached anything to look at, which put the diagram below the fold on a 1366x768 laptop.
  const readoutRow = el('div', { class: 'readout-row' }, el('div', {}, stats, statsNote), orientation);

  root.append(
    banner,
    readoutRow,
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
