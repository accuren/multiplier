/**
 * @accuren/multiplier — the arithmetic behind tokenized-stock multipliers.
 *
 * A tokenized stock is not a share; it is a claim on one, and a `multiplier`
 * decides how much of a share each token currently represents. When the
 * underlying pays a dividend the multiplier ticks up and your balance does
 * not move — so the income exists, is taxable, and leaves no transaction in
 * your wallet for any tool to find.
 *
 * This package turns a series of multiplier readings into the events that
 * follow from them. It has no network access and no opinion about tax law.
 */
export * from "./decimal.ts";

import {
  type Dec,
  cmp,
  dec,
  div,
  gt,
  isZero,
  mul,
  round,
  sub,
  toString,
} from "./decimal.ts";

/** A multiplier as it stood at a given block. */
export type MultiplierPoint = {
  /** Block height the value was read at. */
  readonly block: number;
  /** ISO date (YYYY-MM-DD) the block belongs to. */
  readonly date: string;
  readonly value: Dec;
  /** Where the value came from — provenance survives into every export. */
  readonly source?: "chain_storage" | "issuer_feed" | "reconstructed";
};

export type MultiplierChangeKind =
  /** The usual case: a distribution accrues, each token is worth more. */
  | "increase"
  /** Fee accrual, or a reverse action: each token is worth less. */
  | "decrease"
  /** Large jump, likely a split or reorganisation rather than a dividend. */
  | "corporate_action"
  | "unchanged";

export type MultiplierChange = {
  readonly from: MultiplierPoint;
  readonly to: MultiplierPoint;
  readonly kind: MultiplierChangeKind;
  /** Shares accrued per token held, exact. */
  readonly perToken: Dec;
};

/** How many real shares a balance represents at a given multiplier. */
export function sharesFor(balance: Dec, multiplier: Dec, scale = 6): Dec {
  return round(mul(balance, multiplier), scale);
}

/**
 * Classify a step between two readings.
 *
 * `splitThreshold` separates a dividend from a corporate action: a
 * distribution moves the multiplier by fractions of a percent, a split moves
 * it by a whole multiple. Anything at or above the threshold is flagged for a
 * human rather than booked as income.
 */
export function classifyChange(
  from: MultiplierPoint,
  to: MultiplierPoint,
  splitThreshold: Dec = dec("0.25"),
): MultiplierChange {
  const delta = sub(to.value, from.value);
  const relative = isZero(from.value) ? delta : div(delta, from.value, 12);

  let kind: MultiplierChangeKind;
  if (isZero(delta)) kind = "unchanged";
  else if (gt(abs(relative), splitThreshold)) kind = "corporate_action";
  else if (cmp(delta, { v: 0n, s: 0 }) > 0) kind = "increase";
  else kind = "decrease";

  return { from, to, kind, perToken: delta };
}

function abs(a: Dec): Dec {
  return { v: a.v < 0n ? -a.v : a.v, s: a.s };
}

/** Income that accrued to a holder across one change. */
export type Accrual = {
  readonly block: number;
  readonly date: string;
  readonly sharesAccrued: Dec;
  readonly kind: MultiplierChangeKind;
  /** Always null: no transaction exists in the wallet for this. That is the point. */
  readonly walletTransaction: null;
};

/**
 * Turn a change into the income it produced for a holder.
 *
 * Returns null when nothing accrued, so callers can map over a whole series
 * and filter without special-casing.
 */
export function accrualFor(
  change: MultiplierChange,
  balance: Dec,
  scale = 6,
): Accrual | null {
  if (change.kind === "unchanged" || change.kind === "corporate_action") return null;
  const sharesAccrued = round(mul(balance, change.perToken), scale);
  if (isZero(sharesAccrued)) return null;
  return {
    block: change.to.block,
    date: change.to.date,
    sharesAccrued,
    kind: change.kind,
    walletTransaction: null,
  };
}

/** What you held, from a block onwards. */
export type BalancePoint = { readonly block: number; readonly balance: Dec };

/**
 * Accruals across a series when the balance itself moved.
 *
 * `accrualFor` assumes one balance for one change, which is only true if you
 * never traded. Real holders buy, sell, and post collateral between
 * distributions, and the income that accrued depends on what was held *at that
 * block* — so this walks both series together.
 *
 * `balances` must be ordered by block. The balance in force is the last one at
 * or before the change; a change before the first balance point accrues
 * nothing, because you held nothing.
 */
export function accrualsOver(
  series: readonly MultiplierPoint[],
  balances: readonly BalancePoint[],
  scale = 6,
): Accrual[] {
  for (let i = 1; i < balances.length; i++) {
    if (balances[i]!.block <= balances[i - 1]!.block) {
      throw new RangeError(`balances are not ordered: block ${balances[i]!.block} follows ${balances[i - 1]!.block}`);
    }
  }

  const out: Accrual[] = [];
  for (const change of changesIn(series)) {
    let held: Dec | null = null;
    for (const point of balances) {
      if (point.block <= change.to.block) held = point.balance;
      else break;
    }
    if (!held) continue;
    const accrual = accrualFor(change, held, scale);
    if (accrual) out.push(accrual);
  }
  return out;
}

/**
 * Walk an ordered series of readings and return every step.
 *
 * Readings must be sorted by block. Duplicates and out-of-order points are a
 * bug in the caller's indexer, so they throw rather than being smoothed over.
 */
export function changesIn(series: readonly MultiplierPoint[], splitThreshold?: Dec): MultiplierChange[] {
  const out: MultiplierChange[] = [];
  for (let i = 1; i < series.length; i++) {
    const from = series[i - 1]!;
    const to = series[i]!;
    if (to.block <= from.block) {
      throw new RangeError(`series is not ordered: block ${to.block} follows ${from.block}`);
    }
    const change = splitThreshold ? classifyChange(from, to, splitThreshold) : classifyChange(from, to);
    if (change.kind !== "unchanged") out.push(change);
  }
  return out;
}

/**
 * The multiplier that applied on a date — the value that was true when an
 * event happened, which is what a tax calculation needs, rather than the
 * value now.
 *
 * Returns null when the date precedes the archive: a gap you can see beats a
 * number you cannot check.
 */
export function valueAt(series: readonly MultiplierPoint[], isoDate: string): MultiplierPoint | null {
  let found: MultiplierPoint | null = null;
  for (const point of series) {
    if (point.date <= isoDate) found = point;
    else break;
  }
  return found;
}

/** Ranges the archive cannot answer for, so they can be reported rather than hidden. */
export function coverageGaps(
  series: readonly MultiplierPoint[],
  maxGapDays: number,
): { from: string; to: string }[] {
  const gaps: { from: string; to: string }[] = [];
  const day = 86_400_000;
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]!;
    const b = series[i]!;
    const spanned = (Date.parse(b.date) - Date.parse(a.date)) / day;
    if (spanned > maxGapDays) gaps.push({ from: a.date, to: b.date });
  }
  return gaps;
}

/** Format a share quantity the way an export does. */
export const formatShares = (a: Dec, scale = 6): string => toString(round(a, scale));
