// A PDF writer with no dependencies.
//
// The documents here are short and text-only, and the base-14 fonts (Helvetica, Courier) need
// no font embedding — which is the part that normally forces a library in. So the whole writer
// is a few hundred lines and the repository keeps zero dependencies.
//
// This module is pure and touches no DOM, so it runs identically in the browser and in Node
// under scripts/check.mjs. That is what lets the refusal below be tested rather than asserted.
//
// The export performs the refusal: a claim labelled c or d never appears as text. It is
// replaced in place by a withheld notice, so the reader sees the shape of what was refused.

const WITHHELD = '[ claim withheld — no source on file ]';

const PAGE = { width: 612, height: 792, margin: 72 };
const INK = [0.1, 0.1, 0.09];
const GREY = [0.42, 0.42, 0.4];
const RED = [0.64, 0.18, 0.18];

/* ------------------------------------------------------- text encoding --- */

// PDF string literals here are WinAnsiEncoding, so one character is one byte and byte offsets
// for the xref table are just string lengths.
const WINANSI = new Map([
  [0x2013, 0x96], [0x2014, 0x97], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2026, 0x85],
]);

function toWinAnsi(text) {
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0);
    if (WINANSI.has(code)) out += String.fromCharCode(WINANSI.get(code));
    else if (code < 256) out += String.fromCharCode(code);
    else out += '?';
  }
  return out;
}

function escapePdf(encoded) {
  return encoded.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[\r\n]/g, ' ');
}

/* -------------------------------------------------------- font metrics --- */

// Helvetica advance widths, 1/1000 em, for ASCII 32..126.
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

// The high WinAnsi codes this demo actually uses.
const HELVETICA_HIGH = new Map([
  [0x85, 1000], [0x91, 191], [0x92, 191], [0x93, 333], [0x94, 333],
  [0x95, 350], [0x96, 556], [0x97, 1000], [0xb7, 278], [0xe9, 556],
]);

const COURIER_WIDTH = 600; // Courier is fixed-pitch: every glyph is 600/1000 em.

function glyphWidth(code, font) {
  if (font === 'C') return COURIER_WIDTH;
  if (code >= 32 && code <= 126) return HELVETICA[code - 32];
  return HELVETICA_HIGH.get(code) ?? 556;
}

// Measures already-encoded (WinAnsi) text.
function measure(encoded, font, size) {
  let total = 0;
  for (let i = 0; i < encoded.length; i += 1) total += glyphWidth(encoded.charCodeAt(i), font);
  return (total / 1000) * size;
}

/* ------------------------------------------------------------ layout --- */

// An atom is one word or one space, carrying its own style. Wrapping works on atoms, so a
// single paragraph can mix Helvetica prose with a Courier notice and still break correctly.
function atomize(runs) {
  const atoms = [];
  for (const run of runs) {
    const encoded = toWinAnsi(run.text);
    const parts = encoded.split(/( )/).filter((p) => p !== '');
    for (const part of parts) {
      atoms.push({
        text: part,
        space: part === ' ',
        font: run.font,
        size: run.size,
        color: run.color,
        width: measure(part, run.font, run.size),
      });
    }
  }
  return atoms;
}

function wrap(atoms, maxWidth) {
  const lines = [];
  let line = [];
  let width = 0;

  for (const atom of atoms) {
    if (atom.space && line.length === 0) continue; // no leading spaces on a wrapped line
    if (width + atom.width > maxWidth && line.length > 0 && !atom.space) {
      while (line.length && line[line.length - 1].space) line.pop();
      lines.push(line);
      line = [];
      width = 0;
    }
    line.push(atom);
    width += atom.width;
  }
  while (line.length && line[line.length - 1].space) line.pop();
  if (line.length) lines.push(line);
  return lines;
}

/* --------------------------------------------------- content stream ops --- */

class Content {
  constructor() {
    this.ops = [];
  }

  text(x, y, atoms) {
    let cursor = x;
    for (const atom of atoms) {
      if (!atom.space) {
        const font = atom.font === 'C' ? '/F3' : atom.font === 'B' ? '/F2' : '/F1';
        this.ops.push('BT');
        this.ops.push(`${font} ${atom.size} Tf`);
        this.ops.push(`${atom.color.map((c) => c.toFixed(3)).join(' ')} rg`);
        this.ops.push(`1 0 0 1 ${cursor.toFixed(2)} ${y.toFixed(2)} Tm`);
        this.ops.push(`(${escapePdf(atom.text)}) Tj`);
        this.ops.push('ET');
      }
      cursor += atom.width;
    }
  }

  rule(x, y, width, color) {
    this.ops.push(`${color.map((c) => c.toFixed(3)).join(' ')} rg`);
    this.ops.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} 0.5 re f`);
  }

  toString() {
    return this.ops.join('\n');
  }
}

/* ------------------------------------------------------- file assembly --- */

function assemble(contentStream, title, pinnedDate) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return `${objects.length} 0 R`;
  };

  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>',
  );
  add(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

  // The date is pinned from seed.config.json, never read from the clock, so the same document
  // always produces a byte-identical file.
  const stamp = `D:${pinnedDate.replace(/-/g, '')}000000Z`;
  const producer = escapePdf(toWinAnsi('provenance demo — consultruss.com'));
  const info = add(
    `<< /Title (${escapePdf(toWinAnsi(title))}) /Producer (${producer}) ` +
      `/CreationDate (${stamp}) >>`,
  );

  let file = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(file.length);
    file += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} /Info ${info} >>\n`;
  file += `startxref\n${xref}\n%%EOF\n`;

  const bytes = new Uint8Array(file.length);
  for (let i = 0; i < file.length; i += 1) bytes[i] = file.charCodeAt(i) & 0xff;
  return bytes;
}

/* --------------------------------------------------------------- build --- */

function isBlocked(claim) {
  return claim.label === 'c' || claim.label === 'd';
}

/**
 * Build the PDF for one document.
 *
 * Returns { bytes, filename, withheldCount, footnotes } so callers — including the test in
 * scripts/check.mjs — can assert on what the file contains without reparsing it.
 */
export function buildDocumentPdf({ doc, sources, posting, pinnedDate }) {
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const claimById = new Map(doc.claims.map((c) => [c.id, c]));

  // Footnote numbers are assigned to shipping claims only, in reading order.
  const footnotes = [];
  const noteNumber = new Map();
  for (const block of doc.blocks) {
    for (const match of (block.text ?? '').matchAll(/\{\{(c\d+)\}\}/g)) {
      const claim = claimById.get(match[1]);
      if (!claim || isBlocked(claim) || noteNumber.has(claim.id)) continue;
      const source = sourceById.get(claim.sourceId);
      noteNumber.set(claim.id, footnotes.length + 1);
      footnotes.push(source ? source.filename : claim.sourceId);
    }
  }

  // How each block type is set. Sizes track the on-page styling so the export reads as the
  // same document rather than as a flattened transcript of it.
  const STYLE = {
    meta: { font: 'C', size: 8.5, color: GREY, after: 11, lead: 12 },
    name: { font: 'B', size: 15, color: INK, after: 3, lead: 19 },
    contact: { font: 'C', size: 8.5, color: GREY, after: 12, lead: 12 },
    section: { font: 'C', size: 8, color: GREY, after: 7, lead: 12, rule: true },
    role: { font: 'B', size: 10, color: INK, after: 3, lead: 14 },
    para: { font: 'H', size: 10.5, color: INK, after: 11, lead: 15 },
    bullet: { font: 'H', size: 10, color: INK, after: 3, lead: 14, bullet: true },
    sig: { font: 'B', size: 10.5, color: INK, after: 0, lead: 15 },
  };

  function runsFor(block, style) {
    const runs = [];
    for (const part of (block.text ?? '').split(/(\{\{c\d+\}\})/)) {
      if (part === '') continue;
      const match = part.match(/^\{\{(c\d+)\}\}$/);
      if (!match) {
        runs.push({ text: part, font: style.font, size: style.size, color: style.color });
        continue;
      }
      const claim = claimById.get(match[1]);
      if (!claim) continue;
      if (isBlocked(claim)) {
        // The claim text itself is never written to the file.
        runs.push({ text: WITHHELD, font: 'C', size: style.size - 1.5, color: RED });
      } else {
        runs.push({ text: claim.text, font: style.font, size: style.size, color: style.color });
        runs.push({ text: ` [${noteNumber.get(claim.id)}]`, font: 'C', size: 7.5, color: GREY });
      }
    }
    return runs;
  }

  const content = new Content();
  const left = PAGE.margin;
  const maxWidth = PAGE.width - PAGE.margin * 2;
  let y = PAGE.height - PAGE.margin;

  // Heading.
  const title = `${doc.label} — ${posting.company}, ${posting.role}`;
  content.text(left, y, atomize([{ text: title, font: 'B', size: 13, color: INK }]));
  y -= 16;
  content.text(
    left,
    y,
    atomize([{ text: 'generated demo data · no real record', font: 'C', size: 8, color: GREY }]),
  );
  y -= 14;
  content.rule(left, y, maxWidth, [0.85, 0.84, 0.81]);
  y -= 24;

  // Body, block by block.
  for (const block of doc.blocks) {
    const style = STYLE[block.type] ?? STYLE.para;

    if (style.rule) {
      content.text(left, y, atomize(runsFor(block, style)));
      y -= 5;
      content.rule(left, y, maxWidth, [0.85, 0.84, 0.81]);
      y -= style.after + 6;
      continue;
    }

    // A role line puts its dates flush right on the same baseline.
    if (block.type === 'role' && block.meta) {
      const metaAtoms = atomize([{ text: block.meta, font: 'C', size: 8, color: GREY }]);
      const metaWidth = metaAtoms.reduce((n, a) => n + a.width, 0);
      content.text(left + maxWidth - metaWidth, y, metaAtoms);
    }

    const prefix = style.bullet ? [{ text: '· ', font: style.font, size: style.size, color: style.color }] : [];
    const indent = style.bullet ? 10 : 0;
    const lines = wrap(atomize([...prefix, ...runsFor(block, style)]), maxWidth - indent);

    lines.forEach((line, i) => {
      content.text(left + (i > 0 ? indent : 0), y, line);
      y -= style.lead;
    });
    y -= style.after;
  }

  // Footnotes.
  if (footnotes.length) {
    y -= 10;
    content.rule(left, y, 180, [0.85, 0.84, 0.81]);
    y -= 18;
    content.text(
      left,
      y,
      atomize([{ text: 'sources', font: 'C', size: 8, color: GREY }]),
    );
    y -= 14;
    footnotes.forEach((filename, i) => {
      content.text(
        left,
        y,
        atomize([{ text: `[${i + 1}] ${filename}`, font: 'C', size: 8, color: GREY }]),
      );
      y -= 12;
    });
  }

  const withheldCount = doc.claims.filter(isBlocked).length;
  if (withheldCount) {
    y -= 8;
    content.text(
      left,
      y,
      atomize([
        {
          text: `${withheldCount} claim(s) withheld: no source record supports them.`,
          font: 'C',
          size: 8,
          color: RED,
        },
      ]),
    );
    y -= 12;
  }

  // Footer.
  content.text(
    left,
    PAGE.margin - 24,
    atomize([
      {
        text: 'Demo data, generated. No real record. consultruss.com/provenance',
        font: 'C',
        size: 7.5,
        color: GREY,
      },
    ]),
  );

  return {
    bytes: assemble(content.toString(), title, pinnedDate),
    filename: `${doc.id}.pdf`,
    withheldCount,
    footnotes,
  };
}

export { WITHHELD };
