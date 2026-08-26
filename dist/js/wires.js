// Shared SVG wire renderer.
//
// Wires are decorative. The SVG is aria-hidden and pointer-events:none; every relationship a
// wire shows is also stated as text in the inspector. Below 900px the CSS hides the layer and
// this module draws nothing.

const NS = 'http://www.w3.org/2000/svg';

const UNSELECTED = { color: '#8a8a84', width: 1, opacity: 0.12 };
const SELECTED = { width: 1.8, opacity: 1 };

// Cubic Bézier only. Control offset is half the horizontal span, floored at 30px so short
// spans still curve rather than kinking.
function path(x1, y1, x2, y2) {
  const d = Math.max(30, (x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}`;
}

function anchors(el, box) {
  const r = el.getBoundingClientRect();
  return {
    left: r.left - box.left,
    right: r.right - box.left,
    mid: r.top - box.top + r.height / 2,
  };
}

function line(d, stroke, width, opacity, dashed) {
  const el = document.createElementNS(NS, 'path');
  el.setAttribute('d', d);
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', stroke);
  el.setAttribute('stroke-width', String(width));
  el.setAttribute('opacity', String(opacity));
  if (dashed) el.setAttribute('stroke-dasharray', '4 4');
  return el;
}

/**
 * Draw every wire, every time. Highlighted wires are drawn last so they sit on top.
 *
 * links: [{ key, source, claim, requirement, color, blocked }]
 *   source is null for a blocked claim — a claim with no record behind it has no left wire,
 *   and its right wire is dashed.
 *
 * active: a Set of keys, a single key, or null. Selecting a source or a requirement lights up
 * every claim that touches it, so the whole chain through that row is visible at once.
 */
export function drawWires(svg, container, links, active) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!svg.isConnected || getComputedStyle(svg).display === 'none') return;

  const box = container.getBoundingClientRect();
  if (box.width === 0) return;

  const keys = active instanceof Set ? active : new Set(active == null ? [] : [active]);
  const ordered = [...links.filter((l) => !keys.has(l.key)), ...links.filter((l) => keys.has(l.key))];

  for (const link of ordered) {
    const on = keys.has(link.key);
    const stroke = on ? link.color : UNSELECTED.color;
    const width = on ? SELECTED.width : UNSELECTED.width;
    const opacity = on ? SELECTED.opacity : UNSELECTED.opacity;

    const claim = anchors(link.claim, box);

    if (link.source) {
      const source = anchors(link.source, box);
      svg.appendChild(line(path(source.right + 6, source.mid, claim.left - 6, claim.mid), stroke, width, opacity, false));
    }

    const requirement = anchors(link.requirement, box);
    svg.appendChild(
      line(path(claim.right + 6, claim.mid, requirement.left - 6, requirement.mid), stroke, width, opacity, link.blocked),
    );
  }
}

/**
 * Redraw on anything that can move an anchor: window resize, container resize, tab activation,
 * and late font load. A plain resize listener misses the last three.
 */
export function onLayoutChange(container, redraw) {
  // Throttle only the window resize stream, which can fire many times per frame.
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      redraw();
    });
  };
  window.addEventListener('resize', schedule);

  // Everything else redraws directly. Deferring these through requestAnimationFrame would
  // strand the wires whenever the page is laid out while it cannot paint — a background tab,
  // or a restored session — because no frame is ever produced to run the callback in.
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => redraw()).observe(container);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => redraw());
  window.addEventListener('load', () => redraw());
  document.addEventListener('visibilitychange', () => redraw());

  return schedule;
}
