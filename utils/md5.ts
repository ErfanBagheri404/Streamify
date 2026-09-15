/**
 * Minimal MD5 — used only for Subsonic's token auth (md5(password + salt)).
 * Pure JS, no native dependency. This is a password-derived auth token, not a
 * security boundary, so the classic algorithm is appropriate here.
 * Public-domain implementation after R. Rivest's reference.
 */

/* eslint-disable no-bitwise */

function add(x: number, y: number): number {
  return (x + y) & 0xffffffff;
}

function rotl(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) & 0xffffffff;
}

function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  a = add(add(a, add(add((b & c) | (~b & d), x), t)), 0);
  return add(rotl(a, s), b);
}
function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  a = add(add(a, add(add((b & d) | (c & ~d), x), t)), 0);
  return add(rotl(a, s), b);
}
function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  a = add(add(a, add(add(b ^ c ^ d, x), t)), 0);
  return add(rotl(a, s), b);
}
function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
  a = add(add(a, add(add(c ^ (b | ~d), x), t)), 0);
  return add(rotl(a, s), b);
}

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const T = Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) & 0xffffffff,
);

function toBytes(input: string): number[] {
  // UTF-8 encode without TextEncoder (older RN/Hermes runtimes).
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    let code = input.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
      i += 1;
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

function wordsFromBytes(bytes: number[]): number[] {
  const words: number[] = [];
  for (let i = 0; i < bytes.length * 8; i += 8) {
    words[i >> 5] |= (bytes[i / 8] & 0xff) << i % 32;
  }
  return words;
}

function toHex(words: number[]): string {
  const hex = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < words.length * 4; i += 1) {
    out += hex.charAt((words[i >> 2] >> ((i % 4) * 8 + 4)) & 0x0f) + hex.charAt((words[i >> 2] >> ((i % 4) * 8)) & 0x0f);
  }
  return out;
}

export function md5(input: string): string {
  const bytes = toBytes(input);
  const bitLen = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  // 64-bit little-endian length (JS bit-ops only reach 32 bits, so two words).
  bytes.push(bitLen & 0xff, (bitLen >>> 8) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 24) & 0xff, 0, 0, 0, 0);

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  const x = wordsFromBytes(bytes);

  for (let i = 0; i < x.length; i += 16) {
    const oa = a;
    const ob = b;
    const oc = c;
    const od = d;
    const w = (k: number) => x[i + k] || 0;

    a = ff(a, b, c, d, w(0), S[0], T[0]);
    d = ff(d, a, b, c, w(1), S[1], T[1]);
    c = ff(c, d, a, b, w(2), S[2], T[2]);
    b = ff(b, c, d, a, w(3), S[3], T[3]);
    a = ff(a, b, c, d, w(4), S[4], T[4]);
    d = ff(d, a, b, c, w(5), S[5], T[5]);
    c = ff(c, d, a, b, w(6), S[6], T[6]);
    b = ff(b, c, d, a, w(7), S[7], T[7]);
    a = ff(a, b, c, d, w(8), S[8], T[8]);
    d = ff(d, a, b, c, w(9), S[9], T[9]);
    c = ff(c, d, a, b, w(10), S[10], T[10]);
    b = ff(b, c, d, a, w(11), S[11], T[11]);
    a = ff(a, b, c, d, w(12), S[12], T[12]);
    d = ff(d, a, b, c, w(13), S[13], T[13]);
    c = ff(c, d, a, b, w(14), S[14], T[14]);
    b = ff(b, c, d, a, w(15), S[15], T[15]);

    a = gg(a, b, c, d, w(1), S[16], T[16]);
    d = gg(d, a, b, c, w(6), S[17], T[17]);
    c = gg(c, d, a, b, w(11), S[18], T[18]);
    b = gg(b, c, d, a, w(0), S[19], T[19]);
    a = gg(a, b, c, d, w(5), S[20], T[20]);
    d = gg(d, a, b, c, w(10), S[21], T[21]);
    c = gg(c, d, a, b, w(15), S[22], T[22]);
    b = gg(b, c, d, a, w(4), S[23], T[23]);
    a = gg(a, b, c, d, w(9), S[24], T[24]);
    d = gg(d, a, b, c, w(14), S[25], T[25]);
    c = gg(c, d, a, b, w(3), S[26], T[26]);
    b = gg(b, c, d, a, w(8), S[27], T[27]);
    a = gg(a, b, c, d, w(13), S[28], T[28]);
    d = gg(d, a, b, c, w(2), S[29], T[29]);
    c = gg(c, d, a, b, w(7), S[30], T[30]);
    b = gg(b, c, d, a, w(12), S[31], T[31]);

    a = hh(a, b, c, d, w(5), S[32], T[32]);
    d = hh(d, a, b, c, w(8), S[33], T[33]);
    c = hh(c, d, a, b, w(11), S[34], T[34]);
    b = hh(b, c, d, a, w(14), S[35], T[35]);
    a = hh(a, b, c, d, w(1), S[36], T[36]);
    d = hh(d, a, b, c, w(4), S[37], T[37]);
    c = hh(c, d, a, b, w(7), S[38], T[38]);
    b = hh(b, c, d, a, w(10), S[39], T[39]);
    a = hh(a, b, c, d, w(13), S[40], T[40]);
    d = hh(d, a, b, c, w(0), S[41], T[41]);
    c = hh(c, d, a, b, w(3), S[42], T[42]);
    b = hh(b, c, d, a, w(6), S[43], T[43]);
    a = hh(a, b, c, d, w(9), S[44], T[44]);
    d = hh(d, a, b, c, w(12), S[45], T[45]);
    c = hh(c, d, a, b, w(15), S[46], T[46]);
    b = hh(b, c, d, a, w(2), S[47], T[47]);

    a = ii(a, b, c, d, w(0), S[48], T[48]);
    d = ii(d, a, b, c, w(7), S[49], T[49]);
    c = ii(c, d, a, b, w(14), S[50], T[50]);
    b = ii(b, c, d, a, w(5), S[51], T[51]);
    a = ii(a, b, c, d, w(12), S[52], T[52]);
    d = ii(d, a, b, c, w(3), S[53], T[53]);
    c = ii(c, d, a, b, w(10), S[54], T[54]);
    b = ii(b, c, d, a, w(1), S[55], T[55]);
    a = ii(a, b, c, d, w(8), S[56], T[56]);
    d = ii(d, a, b, c, w(15), S[57], T[57]);
    c = ii(c, d, a, b, w(6), S[58], T[58]);
    b = ii(b, c, d, a, w(13), S[59], T[59]);
    a = ii(a, b, c, d, w(4), S[60], T[60]);
    d = ii(d, a, b, c, w(11), S[61], T[61]);
    c = ii(c, d, a, b, w(2), S[62], T[62]);
    b = ii(b, c, d, a, w(9), S[63], T[63]);

    a = add(a, oa);
    b = add(b, ob);
    c = add(c, oc);
    d = add(d, od);
  }

  return toHex([a, b, c, d]);
}
