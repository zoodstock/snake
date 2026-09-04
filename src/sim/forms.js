/*
 * The shapes the player can take.
 *
 * A blue apple turns the snake into one of three creatures, and that form lasts
 * until the next blue apple is eaten — so the run keeps changing character rather
 * than ticking down a timer. Gameplay numbers only: what each one looks like is
 * the renderer's business.
 */

/**
 * `grab`   extra world units of reach on the body that kills a rival on contact.
 * `reach`  multiplier on how far the head can pick food up.
 * `boost*` multipliers on the stamina economy and the boost top speed.
 */
export const FORMS = {
  snake: {
    id: 'snake', name: 'snake',
    grab: 0, reach: 1, boostDrain: 1, boostRegen: 1, boostSpeed: 1,
  },
  // Tentacles: rivals die on a much wider body than they can see.
  kraken: {
    id: 'kraken', name: 'kraken',
    grab: 1.5, reach: 1, boostDrain: 1, boostRegen: 1, boostSpeed: 1,
  },
  // Built for the deep: boost costs less than half, comes back faster, runs harder.
  abyss: {
    id: 'abyss', name: 'abyss',
    grab: 0, reach: 1, boostDrain: 0.45, boostRegen: 1.8, boostSpeed: 1.18,
  },
  // Two heads, so food is picked up from twice as far out.
  twin: {
    id: 'twin', name: 'twin',
    grab: 0, reach: 2, boostDrain: 1, boostRegen: 1, boostSpeed: 1,
  },
};

/** What a blue apple can turn you into. `snake` is only the form you start in. */
export const MORPHS = ['kraken', 'abyss', 'twin'];

/**
 * Pick the next form, never the one already worn — every blue apple has to visibly
 * change something. `rand` is the world's seeded PRNG, so this stays reproducible.
 */
export function nextForm(current, rand) {
  const options = MORPHS.filter((id) => id !== current);
  const i = Math.floor(rand() * options.length);
  return options[Math.min(options.length - 1, Math.max(0, i))];
}
