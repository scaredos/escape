// Deterministic randomness shared by every peer (spec 01 §1). Never use Math.random in world generation.

/** Clone of Unreal's FRandomStream. */
export class Rng {
  seed: number;
  constructor(seed: number) { this.seed = seed >>> 0; }
  private next(): number { this.seed = (Math.imul(this.seed, 196314165) + 907633515) >>> 0; return this.seed; }
  /** [0, 1): float with mantissa bits from seed >> 9. */
  frand(): number { return (this.next() >>> 9) / 8388608; }
  range(a: number, b: number): number { return a + (b - a) * this.frand(); }
  /** 0..n-1 */
  helper(n: number): number { return n > 0 ? Math.min(Math.trunc(this.frand() * n), n - 1) : 0; }
  /** a..b inclusive */
  int(a: number, b: number): number { return a + this.helper(b - a + 1); }
  bool(): boolean { return this.helper(2) === 1; }
  pick<T>(a: readonly T[]): T { return a[this.helper(a.length)]; }
}

/** 32-bit FNV-1a over the lower-cased string (case-insensitive like Unreal's GetTypeHash for FString). */
export function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { let c = s.charCodeAt(i); if (c >= 65 && c <= 90) c += 32; h ^= c; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/** Hash of an integer pair (desert scatter cells). */
export function hashInts(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Non-world randomness for gameplay rolls on the host (seedable for tests via ?seed=). */
export let gameRng = new Rng((Date.now() ^ 0x5eed) >>> 0);
export function seedGameRng(seed: number) { gameRng = new Rng(seed); }
