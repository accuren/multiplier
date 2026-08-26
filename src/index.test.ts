import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accrualFor,
  accrualsOver,
  changesIn,
  classifyChange,
  coverageGaps,
  dec,
  div,
  formatShares,
  round,
  sharesFor,
  toString,
  valueAt,
  type MultiplierPoint,
} from "./index.ts";

const at = (block: number, date: string, value: string): MultiplierPoint => ({
  block,
  date,
  value: dec(value),
});

test("decimal arithmetic is exact where floats are not", () => {
  assert.equal(toString(dec("0.1")), "0.1");
  // The canonical float failure: 0.1 + 0.2 === 0.30000000000000004
  const sum = toString(round(dec("0.30000000000000004"), 17));
  assert.notEqual(sum, "0.3");
  assert.equal(toString(dec("120.0000")), "120.0000");
});

test("rejects input that is already lossy", () => {
  assert.throws(() => dec(1e21), /string/);
  assert.throws(() => dec("twelve"), /not a decimal/);
  assert.throws(() => dec(Number.POSITIVE_INFINITY), /not a decimal/);
});

test("half-even rounding does not drift upward over a series", () => {
  assert.equal(toString(round(dec("2.5"), 0)), "2");
  assert.equal(toString(round(dec("3.5"), 0)), "4");
  assert.equal(toString(round(dec("-2.5"), 0)), "-2");
  assert.equal(toString(round(dec("2.5"), 0, "half-up")), "3");
});

test("division needs an explicit scale and rounds the last digit", () => {
  assert.equal(toString(div(dec("1"), dec("3"), 8)), "0.33333333");
  assert.equal(toString(div(dec("2"), dec("3"), 4)), "0.6667");
  assert.throws(() => div(dec("1"), dec("0"), 2), /division by zero/);
});

test("shares are balance times multiplier, exactly", () => {
  assert.equal(formatShares(sharesFor(dec("120"), dec("1.0341"))), "124.092000");
  assert.equal(formatShares(sharesFor(dec("0"), dec("1.0341"))), "0.000000");
});

test("a dividend accrues income with no wallet transaction", () => {
  const change = classifyChange(at(1, "2026-08-13", "1.0338"), at(2, "2026-08-14", "1.0341"));
  assert.equal(change.kind, "increase");

  const accrual = accrualFor(change, dec("120"));
  assert.ok(accrual);
  assert.equal(formatShares(accrual.sharesAccrued), "0.036000");
  // The whole reason this library exists.
  assert.equal(accrual.walletTransaction, null);
});

test("a split is flagged for a human, not booked as income", () => {
  const change = classifyChange(at(1, "2026-08-13", "1.0000"), at(2, "2026-08-14", "4.0000"));
  assert.equal(change.kind, "corporate_action");
  assert.equal(accrualFor(change, dec("120")), null);
});

test("fee accrual reduces the multiplier and is not income", () => {
  const change = classifyChange(at(1, "2026-08-13", "1.0341"), at(2, "2026-08-14", "1.0339"));
  assert.equal(change.kind, "decrease");
});

test("an unchanged reading produces nothing", () => {
  const change = classifyChange(at(1, "2026-08-13", "1.0341"), at(2, "2026-08-14", "1.0341"));
  assert.equal(change.kind, "unchanged");
  assert.equal(accrualFor(change, dec("120")), null);
});

test("a series yields one change per step, skipping flat ones", () => {
  const series = [
    at(1, "2026-01-01", "1.0000"),
    at(2, "2026-02-01", "1.0000"),
    at(3, "2026-03-01", "1.0112"),
  ];
  const changes = changesIn(series);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.to.date, "2026-03-01");
});

test("an unordered series is a bug and says so", () => {
  assert.throws(() => changesIn([at(5, "2026-03-01", "1.01"), at(2, "2026-02-01", "1.00")]), /not ordered/);
});

test("valueAt returns what was true on the day, not what is true now", () => {
  const series = [at(1, "2026-01-01", "1.0000"), at(2, "2026-05-15", "1.0338"), at(3, "2026-08-14", "1.0341")];
  assert.equal(toString(valueAt(series, "2026-06-01")!.value), "1.0338");
  assert.equal(toString(valueAt(series, "2026-05-15")!.value), "1.0338");
  // Before the archive starts, a gap you can see beats a number you cannot check.
  assert.equal(valueAt(series, "2025-12-31"), null);
});

test("coverage gaps are reported rather than smoothed over", () => {
  const series = [at(1, "2026-01-01", "1.0000"), at(2, "2026-06-01", "1.0338")];
  assert.deepEqual(coverageGaps(series, 45), [{ from: "2026-01-01", to: "2026-06-01" }]);
  assert.deepEqual(coverageGaps(series, 200), []);
});

test("accruals follow the balance you actually held at each block", () => {
  const series = [
    at(100, "2026-01-01", "1.0000"),
    at(200, "2026-04-01", "1.0100"),
    at(300, "2026-07-01", "1.0200"),
  ];
  // Bought 100 at block 50, sold half at block 250.
  const balances = [
    { block: 50, balance: dec("100") },
    { block: 250, balance: dec("50") },
  ];

  const accruals = accrualsOver(series, balances);
  assert.equal(accruals.length, 2);
  // First change: still holding 100, multiplier +0.01 → 1 share.
  assert.equal(formatShares(accruals[0]!.sharesAccrued), "1.000000");
  // Second change: only 50 left, so half the income. Using a single balance
  // would have doubled it.
  assert.equal(formatShares(accruals[1]!.sharesAccrued), "0.500000");
});

test("nothing accrues before you held anything", () => {
  const series = [at(100, "2026-01-01", "1.0000"), at(200, "2026-04-01", "1.0100")];
  const accruals = accrualsOver(series, [{ block: 500, balance: dec("100") }]);
  assert.equal(accruals.length, 0);
});

test("unordered balances are a bug and say so", () => {
  const series = [at(100, "2026-01-01", "1.0000"), at(200, "2026-04-01", "1.0100")];
  assert.throws(
    () => accrualsOver(series, [{ block: 300, balance: dec("1") }, { block: 100, balance: dec("2") }]),
    /not ordered/,
  );
});
