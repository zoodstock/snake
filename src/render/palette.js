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
