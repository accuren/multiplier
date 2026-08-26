/**
 * Exact decimal arithmetic on bigint.
 *
 * A multiplier is the number that decides how many real shares a tokenized
 * stock represents. Rounding it wrong does not produce a slightly wrong
 * number — it produces a wrong cost basis on every disposal that follows, in
 * a filing somebody signs. So no floats anywhere in this file.
 *
 * A Dec is `v / 10^s`: the integer `v` scaled by `s` decimal places.
 */
export type Dec = { readonly v: bigint; readonly s: number };

const TEN = 10n;

function pow10(n: number): bigint {
  return TEN ** BigInt(n);
}

/** Parse a decimal string. Throws rather than guessing at bad input. */
export function dec(input: string | number | bigint): Dec {
  if (typeof input === "bigint") return { v: input, s: 0 };
  const text = typeof input === "number" ? numberToText(input) : input.trim();
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
    throw new TypeError(`not a decimal: ${JSON.stringify(input)}`);
  }
  const [, sign, whole = "", frac = ""] = m;
  const v = BigInt(`${whole || "0"}${frac}`) * (sign === "-" ? -1n : 1n);
  return { v, s: frac.length };
}

function numberToText(n: number): string {
  if (!Number.isFinite(n)) throw new TypeError(`not a decimal: ${n}`);
  // A float literal is already lossy; refuse the ones that are visibly so.
  const text = String(n);
  if (text.includes("e") || text.includes("E")) {
    throw new TypeError(`pass ${text} as a string to keep it exact`);
  }
  return text;
}

/** Re-express a Dec at a larger scale. Never loses information. */
function widen(a: Dec, s: number): bigint {
  return a.v * pow10(s - a.s);
}

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [widen(a, s), widen(b, s), s];
}

export function add(a: Dec, b: Dec): Dec {
  const [x, y, s] = align(a, b);
  return { v: x + y, s };
}

export function sub(a: Dec, b: Dec): Dec {
  const [x, y, s] = align(a, b);
  return { v: x - y, s };
}

export function mul(a: Dec, b: Dec): Dec {
  return { v: a.v * b.v, s: a.s + b.s };
}

/** Compare. Returns -1, 0, or 1. */
export function cmp(a: Dec, b: Dec): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export const eq = (a: Dec, b: Dec) => cmp(a, b) === 0;
export const lt = (a: Dec, b: Dec) => cmp(a, b) < 0;
export const gt = (a: Dec, b: Dec) => cmp(a, b) > 0;
export const isZero = (a: Dec) => a.v === 0n;
export const isNegative = (a: Dec) => a.v < 0n;
export const neg = (a: Dec): Dec => ({ v: -a.v, s: a.s });
export const abs = (a: Dec): Dec => ({ v: a.v < 0n ? -a.v : a.v, s: a.s });

export type Rounding = "half-up" | "half-even" | "down";

/**
 * Round to `scale` decimal places.
 *
 * `half-even` (banker's rounding) is the default because repeatedly rounding
 * half-up on a long series of accruals drifts upward, and a tax figure that
 * drifts in one direction is the kind an auditor notices.
 */
export function round(a: Dec, scale: number, mode: Rounding = "half-even"): Dec {
  if (scale >= a.s) return { v: widen(a, scale), s: scale };

  const factor = pow10(a.s - scale);
  const q = a.v / factor;
  const r = a.v % factor;
  if (r === 0n) return { v: q, s: scale };

  const sign = a.v < 0n ? -1n : 1n;
  const twice = (r < 0n ? -r : r) * 2n;

  if (mode === "down") return { v: q, s: scale };
  if (twice > factor) return { v: q + sign, s: scale };
  if (twice < factor) return { v: q, s: scale };
  // Exactly half.
  if (mode === "half-up") return { v: q + sign, s: scale };
  return { v: q % 2n === 0n ? q : q + sign, s: scale };
}

/** Divide to a fixed number of decimal places. `scale` is required: there is no correct default. */
export function div(a: Dec, b: Dec, scale: number, mode: Rounding = "half-even"): Dec {
  if (b.v === 0n) throw new RangeError("division by zero");
  // Compute one extra place, then round it — so the rounding mode decides the
  // last digit rather than truncation quietly doing it first.
  const shift = scale + 1 + b.s - a.s;
  const numerator = shift >= 0 ? a.v * pow10(shift) : a.v / pow10(-shift);
  return round({ v: numerator / b.v, s: scale + 1 }, scale, mode);
}

export function toString(a: Dec): string {
  const negative = a.v < 0n;
  const digits = (negative ? -a.v : a.v).toString().padStart(a.s + 1, "0");
  const whole = digits.slice(0, digits.length - a.s) || "0";
  const frac = a.s > 0 ? `.${digits.slice(digits.length - a.s)}` : "";
  return `${negative ? "-" : ""}${whole}${frac}`;
}

/** Lossy on purpose, and named so you notice. Never use the result in a filing. */
export function toNumberUnsafe(a: Dec): number {
  return Number(toString(a));
}

export const ZERO: Dec = { v: 0n, s: 0 };
export const ONE: Dec = { v: 1n, s: 0 };
