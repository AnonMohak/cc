import { CATALOGUE, formatLightYears } from '../galaxy/catalogue.js';

/**
 * Facts for a galaxy entry that came from the catalogue, or null.
 * Pure, so it is testable without a DOM.
 * @param {{ catalog?: string | null, name: string } | null | undefined} entry
 */
export function infoFor(entry) {
  const c = entry?.catalog ? CATALOGUE[entry.catalog] : null;
  if (!c) return null;
  return {
    title: c.name,
    // The user may have renamed it; say what it is based on.
    subtitle: entry.name !== c.name ? `“${entry.name}”, based on ${c.name}` : c.type,
    rows: [
      ['Type', c.type],
      ['Distance', formatLightYears(c.distanceLy)],
      ['Diameter', formatLightYears(c.diameterLy)],
      ['Constellation', c.constellation],
      ['Inclination', `${c.inclination}°`],
    ],
    fact: c.fact,
  };
}

/**
 * Overlay card with real facts about the selected catalogue galaxy.
 * @param {HTMLElement} container
 * @param {ReturnType<typeof import('../state/store.js').createStore>} store
 */
export function createInfoCard(container, store) {
  const el = document.createElement('aside');
  el.className = 'info-card';
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  container.appendChild(el);

  function render(state) {
    const entry = state.galaxies.find((g) => g.id === state.selectedId);
    const info = infoFor(entry);
    el.hidden = !info;
    if (!info) return;
    el.replaceChildren();
    const h = document.createElement('h2');
    h.textContent = info.title;
    const sub = document.createElement('p');
    sub.className = 'info-sub';
    sub.textContent = info.subtitle;
    const dl = document.createElement('dl');
    for (const [k, v] of info.rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dl.append(dt, dd);
    }
    const fact = document.createElement('p');
    fact.className = 'info-fact';
    fact.textContent = info.fact;
    el.append(h, sub, dl, fact);
  }

  render(store.getState());
  return store.subscribe((next, prev) => {
    if (next.selectedId !== prev.selectedId || next.galaxies !== prev.galaxies) render(next);
  });
}
