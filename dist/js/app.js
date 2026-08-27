// Tab shell and router.
//
// Tab state lives in the location hash so a tab can be linked directly. Views mount lazily on
// first activation and are kept afterwards, so switching tabs never re-renders the chain.

import { mountProvenance } from './provenance.js?v=567acd4a';
import { mountGates } from './gates.js?v=567acd4a';
import { mountPressure } from './pressure.js?v=567acd4a';

const VIEWS = [
  { id: 'provenance', mount: mountProvenance },
  { id: 'gates', mount: mountGates },
  { id: 'pressure', mount: mountPressure },
  { id: 'how', mount: null }, // static markup in index.html
];

const DEFAULT = 'provenance';

const tabs = new Map();
const panels = new Map();
const mounted = new Map();

function activate(id, { focusTab = false } = {}) {
  const target = VIEWS.some((v) => v.id === id) ? id : DEFAULT;

  for (const view of VIEWS) {
    const isCurrent = view.id === target;
    const tab = tabs.get(view.id);
    const panel = panels.get(view.id);
    if (!tab || !panel) continue;

    tab.setAttribute('aria-selected', isCurrent ? 'true' : 'false');
    tab.tabIndex = isCurrent ? 0 : -1;
    panel.hidden = !isCurrent;
  }

  const view = VIEWS.find((v) => v.id === target);
  if (view?.mount && !mounted.has(target)) {
    mounted.set(target, view.mount(panels.get(target)) ?? {});
  }

  // Wires can only be measured once the panel is visible.
  mounted.get(target)?.redraw?.();

  if (focusTab) tabs.get(target)?.focus();
  if (window.location.hash.slice(1) !== target) {
    window.history.replaceState(null, '', `#${target}`);
  }
}

function onTabKeydown(event) {
  const order = VIEWS.map((v) => v.id);
  const current = order.indexOf(event.currentTarget.dataset.tab);
  let next = null;

  if (event.key === 'ArrowRight') next = (current + 1) % order.length;
  else if (event.key === 'ArrowLeft') next = (current - 1 + order.length) % order.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = order.length - 1;
  else return;

  event.preventDefault();
  activate(order[next], { focusTab: true });
}

function start() {
  for (const view of VIEWS) {
    const tab = document.querySelector(`[data-tab="${view.id}"]`);
    const panel = document.getElementById(`panel-${view.id}`);
    if (!tab || !panel) continue;
    tabs.set(view.id, tab);
    panels.set(view.id, panel);
    tab.addEventListener('click', () => activate(view.id));
    tab.addEventListener('keydown', onTabKeydown);
  }

  window.addEventListener('hashchange', () => activate(window.location.hash.slice(1)));
  activate(window.location.hash.slice(1) || DEFAULT);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
