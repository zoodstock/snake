/*
 * The game's colours, and the helpers that build them.
 */

/** Hex string or 0xRRGGBB to an [r, g, b] triple in 0..1. */

export function color(hex) {
  const n = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Blend two [r,g,b] triples. */
export function mixColor(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export const PALETTE = {

  skyTop: color(0x2f7fd0),
  skyHorizon: color(0xa8dcf2),
  fog: color(0x9fd0e8),
  grassA: color(0x5aa84f),
  grassB: color(0x4f9b47),
  grassLine: color(0x3f7f3a),
  edgeWarn: color(0xd8b24a),
  wallA: color(0xdcd6c8),
  wallB: color(0xb8b1a1),
  wallAccent: color(0xe0575f),
  obstacle: [color(0x9096a4), color(0xb5793f), color(0x6f8fb5)],
  obstacleTop: color(0xffffff),
  playerBody: [color(0x63d94e), color(0x3faf3a)],
  playerHead: color(0x7cec62),
  eye: color(0xffffff),
  pupil: color(0x141a20),
  tongue: color(0xf25c7f),
  food: color(0xe8434f),
  foodGold: color(0xffc63c),
  rivals: [
    [color(0xa661e8), color(0x7d3fbf), color(0xbb85f0)],
    [color(0xf0973c), color(0xc86a1e), color(0xf7b163)],
    [color(0x3fd0d8), color(0x2596a3), color(0x74e6ea)],
    [color(0xf05a9b), color(0xbf3c74), color(0xf788b8)],
  ],
};
