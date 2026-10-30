import { createHash } from 'crypto';
import { sha256Hex } from './sha256';

const node = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** A small seeded generator, so a failing random case reproduces. */
function generator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Code points from every UTF-8 length: ASCII, two-byte, three-byte, astral, and lone surrogates. */
const POOLS: readonly (readonly [number, number])[] = [
  [0x20, 0x7e],
  [0x00, 0x1f],
  [0x80, 0x7ff],
  [0x800, 0xd7ff],
  [0xe000, 0xfffd],
  [0x10000, 0x10ffff],
  [0xd800, 0xdfff],
];

function randomText(random: () => number, length: number): string {
  let text = '';
  while (text.length < length) {
    const [low, high] = POOLS[Math.floor(random() * POOLS.length)];
    const point = low + Math.floor(random() * (high - low + 1));
    text +=
      point >= 0xd800 && point <= 0xdfff ? String.fromCharCode(point) : String.fromCodePoint(point);
  }
  return text;
}

describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    ['team-m/catalog/appé', '1204f2bce3abf11137205930eb7e05320e04afa61975d33e5370c842f4121b23'],
  ])('hashes %j as FIPS 180-4 does', (text, digest) => {
    expect(sha256Hex(text)).toBe(digest);
  });

  it('hashes one million a', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    );
  });

  it('crosses every padding boundary as Node does', () => {
    for (let length = 0; length <= 130; length += 1) {
      const text = 'x'.repeat(length);
      expect(sha256Hex(text)).toBe(node(text));
    }
  });

  it("equals Node's createHash on 200 random strings, astral and lone surrogates included", () => {
    const random = generator(0x5eed);
    for (let i = 0; i < 200; i += 1) {
      const text = randomText(random, Math.floor(random() * 301));
      expect(sha256Hex(text)).toBe(node(text));
    }
  });
});
