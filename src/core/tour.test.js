import { describe, it, expect } from 'vitest';
import { createTour } from './tour.js';

const run = (tour, seconds, step = 0.5) => {
  const events = [];
  for (let t = 0; t < seconds; t += step) {
    const e = tour.tick(step);
    if (e) events.push(e);
  }
  return events;
};

describe('createTour', () => {
  it('flies to each galaxy, dwells, then ends', () => {
    const tour = createTour(() => ['a', 'b'], { flySeconds: 1, dwellSeconds: 2 });
    expect(tour.start()).toEqual({ type: 'fly', id: 'a' });
    expect(tour.isActive()).toBe(true);
    expect(run(tour, 10)).toEqual([
      { type: 'dwell', id: 'a' },
      { type: 'fly', id: 'b' },
      { type: 'dwell', id: 'b' },
      { type: 'end' },
    ]);
    expect(tour.isActive()).toBe(false);
  });

  it('ends at once with no galaxies', () => {
    expect(createTour(() => []).start()).toEqual({ type: 'end' });
  });

  it('skips galaxies deleted during the tour', () => {
    let ids = ['a', 'b', 'c'];
    const tour = createTour(() => ids, { flySeconds: 1, dwellSeconds: 1 });
    tour.start();
    ids = ['a', 'c'];
    const flights = run(tour, 10)
      .filter((e) => e.type === 'fly')
      .map((e) => e.id);
    expect(flights).toEqual(['c']);
  });

  it('stop() ends it and later ticks do nothing', () => {
    const tour = createTour(() => ['a'], { flySeconds: 1, dwellSeconds: 1 });
    tour.start();
    tour.stop();
    expect(tour.tick(5)).toBeNull();
    expect(tour.current()).toBeNull();
  });

  it('can run several laps', () => {
    const tour = createTour(() => ['a', 'b'], { flySeconds: 1, dwellSeconds: 1, laps: 2 });
    tour.start();
    const flights = run(tour, 20)
      .filter((e) => e.type === 'fly')
      .map((e) => e.id);
    expect(flights).toEqual(['b', 'a', 'b']);
  });
});
