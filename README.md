# provenance

A public demo page: a document generator with a provenance check inside it.

Every factual claim in a generated document carries a label saying how well it is sourced.
Claims with a weak label cannot ship. The page makes that visible — a source record on the
left, the document in the middle, the job requirement on the right, and a wire between them.

**The demo data is generated. No real record enters this repository.** Every company, person,
place and file name below is invented. The page belongs to Russell W. Hild / consultruss.com.

Deploys to `consultruss.com/provenance`.

## Commands

```bash
npm run seed     # regenerate data/generated/* and src/js/data.js from data/seed.config.json
npm run build    # write dist/
npm run check    # run the acceptance checks
```

No dependencies. Node is used for the three scripts only; the page itself is plain HTML, CSS
and ES modules.

To look at it locally, serve the folder — do not open `index.html` from the filesystem. Module
scripts are CORS-checked and a `file://` origin is opaque, so browsers refuse to load them:

```bash
cd dist && python -m http.server 8137
```

## The labels

| Label | Meaning | Ships |
|---|---|---|
| a | said directly by the subject | yes |
| b | confirmed against a record | yes |
| c | asserted by a tool, never confirmed | no |
| d | exists only in a derived document | no |

A claim labelled c or d carries `sourceId: "s0"`, the null source. There is nothing to cite, so
it draws no wire on the left. `npm run check` fails if that is ever untrue.

## Layout

```
data/seed.config.json      every invented name and every authored string
data/generated/*.json      generator output, committed, meant to be opened and read
scripts/generate.mjs       writes the four JSON files and src/js/data.js
scripts/build.mjs          copies src/ to dist/
scripts/check.mjs          the acceptance checks
src/                       the page
design/provenance-mock.html  the visual reference this was built against, not shipped
dist/                      build output, committed, deployed
```

Three files sit outside the original brief and are worth explaining:

- **`src/js/data.js`** is generated alongside the JSON. The page imports it instead of fetching
  it, so the page issues no data request at all and needs no base-path logic to work from a
  subdirectory. The JSON files stay the artifact a reviewer opens; this is the same content as
  a module.
- **`src/js/pdf.js`** writes PDFs directly, with no library. The documents are short and
  text-only, and the base-14 fonts need no embedding, so a few hundred lines replaces a
  ~350 KB dependency and keeps the no-CDN rule literally true.
- **`src/js/dom.js`** is a fifteen-line `createElement` helper. Nothing on the page is built
  from interpolated HTML strings.

## The export

The download button writes a PDF of the document on screen, and the export performs the
refusal rather than working around it:

- A blocked claim is never written to the file. It is replaced in place by
  `[ claim withheld — no source on file ]`.
- Every claim that ships carries a footnote naming the source file it came from, so the
  document keeps its provenance once detached from the page.
- The creation date is pinned to `seed.config.json`, so the same document always produces a
  byte-identical PDF.

This was added after the brief was written; the brief listed PDF export as out of scope, and
that decision was reversed deliberately.

## Determinism

`npm run seed` is a pure function of `data/seed.config.json`. There is no `Date.now()`, no
`Math.random()`, and no `Intl`/locale formatting anywhere in the generator — locale output
depends on the ICU build Node was compiled with, which would make the seed machine-dependent.
The generator asserts its own totals and throws rather than emitting a corpus that does not add
up.

## What the checks cover

`npm run check` decides these automatically:

| Check | What it proves |
|---|---|
| 16.1 | `npm run seed` twice is byte-identical |
| 16.2 | no real company name, no name belonging to another project on this machine |
| 16.3 | every claim labelled c or d cites `s0`, and no shipping claim cites it |
| 16.6 | the first document carries a blocked claim to open on |
| 16.8 | the gate data contains at least one `exit 1` run |
| 16.9 | at least one requirement lands on `do not have` |
| 16.11 | nothing in `src/` or `dist/` references an external host |
| 16.12 | the exported PDF draws no blocked claim text, and footnotes every claim that ships |

The denylist in check 16.2 is a list, not a guess. Extend it in `scripts/check.mjs` rather than
relying on memory.

These four are checked by hand in a browser, because a script cannot decide them:

- **16.4** — click a claim, then a source, then a requirement, then an inspector chip to return
  to a claim. The console stays clean at every step.
- **16.5** — switching documents leaves both rails unchanged and updates every requirement dot.
- **16.7** — resizing the window redraws the wires onto the correct anchors.
- **16.10** — keyboard alone reaches and activates every claim, source and requirement.

## Deploy

`npm run build` writes `dist/`. Every asset path is relative, so the folder works from any
subdirectory. Deployment copies `dist/` into the site's deploy folder under `/provenance`.
Nothing in this repository touches the site repository.
