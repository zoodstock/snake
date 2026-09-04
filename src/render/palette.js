/*
 * The game's colours.
 *
 * Hex numbers are the source of truth: three.js reads them with `new Color(hex)`,
 * which converts sRGB to its linear working space for us. Anything that needs raw
 * channel values (the 2D minimap) goes through rgb255().
 */

export const PALETTE = {
  sky: 0x2f7fd0,
  skyHorizon: 0xa8dcf2,
  fog: 0x9fd0e8,
  grassA: 0x5aa84f,
  grassB: 0x4f9b47,
  grassLine: 0x3f7f3a,
  edgeWarn: 0xd8b24a,
  wallA: 0xdcd6c8,
  wallB: 0xb8b1a1,
  wallAccent: 0xe0575f,
  obstacle: [0x9096a4, 0xb5793f, 0x6f8fb5],
  playerBody: [0x63d94e, 0x3faf3a],
  playerHead: 0x7cec62,
  eye: 0xffffff,
  pupil: 0x141a20,
  tongue: 0xf25c7f,
  food: 0xe8434f,
  foodGold: 0xffc63c,
  foodBlue: 0x4ea8ff,
  // What the player looks like in each shape a blue apple can grant, as
  // [body A, body B, head]. Keyed by the form ids in sim/forms.js. All three stay
  // clear of the rival palettes above so the player is still findable at a glance.
  forms: {
    kraken: [0x4b5f4a, 0x33422f, 0x5e7355],
    abyss: [0x1b2432, 0x121927, 0x27354a],
    twin: [0x8a6f45, 0x5c4a2e, 0xa08054],
  },
  // Trim colours the forms need on top of the usual body/head/eye set.
  krakenMaw: 0xd8c9a8,      // the pale jaw and teeth
  krakenTentacle: 0x8c9c6e,
  abyssSpot: 0xdff2ff,      // the white flecks down the flanks
  abyssVent: 0xff8a2b,      // the orange glow between the plates
  abyssLure: 0xff3b30,      // the red tips on the feelers
  twinBand: 0xd9c9a4,
  // Each rival gets [body A, body B, head].
  rivals: [
    [0xa661e8, 0x7d3fbf, 0xbb85f0],
    [0xf0973c, 0xc86a1e, 0xf7b163],
    [0x3fd0d8, 0x2596a3, 0x74e6ea],
    [0xf05a9b, 0xbf3c74, 0xf788b8],
  ],
};

/** 0xRRGGBB to "r,g,b" in 0..255, for canvas/CSS colour strings. */
export function rgb255(hex) {
  return ((hex >> 16) & 255) + ',' + ((hex >> 8) & 255) + ',' + (hex & 255);
}

/** Brighten a hex colour toward white by `t` (0..1). Used for the boost glow. */
export function brighten(hex, t) {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const mix = (c) => Math.round(c + (255 - c) * t);
  return (mix(r) << 16) | (mix(g) << 8) | mix(b);
}
