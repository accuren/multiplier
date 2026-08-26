# @accuren/multiplier

Exact decimal arithmetic and multiplier maths for tokenized stocks.

A tokenized stock is not a share; it is a claim on one, and a `multiplier`
decides how much of a share each token currently represents. When the
underlying pays a dividend the multiplier ticks up and your balance does not
move — so the income exists, is taxable, and leaves no transaction behind.

No floats anywhere. A multiplier rounded wrong does not produce a slightly
wrong number; it produces a wrong cost basis on every disposal that follows.

```ts
import { dec, changesIn, accrualFor, sharesFor, formatShares } from "@accuren/multiplier";

const series = [
  { block: 41_208_113, date: "2025-11-14", value: dec("1.0000") },
  { block: 44_318_090, date: "2026-05-15", value: dec("1.0338") },
  { block: 44_901_772, date: "2026-08-14", value: dec("1.0341") },
];

const balance = dec("120");
formatShares(sharesFor(balance, dec("1.0341"))); // "124.092000"

for (const change of changesIn(series)) {
  const accrual = accrualFor(change, balance);
  if (accrual) {
    accrual.sharesAccrued;       // exact
    accrual.walletTransaction;   // null — the whole point
  }
}
```

## API

- `dec`, `add`, `sub`, `mul`, `div`, `round`, `cmp`, `toString` — exact decimals on `bigint`.
  `div` requires an explicit scale; there is no correct default. Rounding is
  half-even by default, because repeated half-up drifts upward and a tax
  figure that drifts in one direction is the kind an auditor notices.
- `sharesFor(balance, multiplier)` — what a holding is worth in real shares.
- `classifyChange(from, to)` — `increase`, `decrease`, `corporate_action`, or
  `unchanged`. A split moves the multiplier by a whole multiple, a dividend by
  fractions of a percent; the threshold separates them so a split is flagged
  for a human rather than booked as income.
- `accrualFor(change, balance)` — the income that accrued, or `null`.
- `changesIn(series)` — every step in an ordered series. Throws on unordered
  input rather than smoothing over a bug in your indexer.
- `valueAt(series, date)` — the multiplier that applied on a date, or `null`.
  A gap you can see beats a number you cannot check.
- `coverageGaps(series, maxGapDays)` — ranges the archive cannot answer for.
- `accrualsOver(series, balances)` — accruals when the balance itself moved.
  `accrualFor` assumes one balance for one change, which is only true if you
  never traded; this walks both series together so income is computed against
  what was actually held at that block.

## Contributing

Bugs in the arithmetic matter more here than features. If a figure comes out
wrong, open an issue with the inputs that produced it — a failing test is the
best possible bug report.

```bash
pnpm install
pnpm test        # node --test, no runner
pnpm typecheck
```

## Part of a set

Four small libraries that split the work of keeping a tax record for
self-custodied tokenized stocks. Each stands alone; use one or all four.

| Package | Does |
|---|---|
| **`@accuren/multiplier`** | Exact decimals and the multiplier maths — you are here |
| [`@accuren/cost-basis`](https://github.com/accuren/cost-basis) | Lot engine, and whether the event was a sale at all |
| [`@accuren/fx`](https://github.com/accuren/fx) | Historical rates carrying source and date |
| [`@accuren/market-hours`](https://github.com/accuren/market-hours) | Sessions, staleness, and weekend exposure |

> **Not on npm yet.** Clone it, or add it as a git dependency, until the
> first release. `cost-basis` and `fx` depend on `@accuren/multiplier`, so that
> one gets published first.

**Requirements:** Node 22.18+ (native type stripping). No build step, no
bundler, no runtime dependencies — the package exports its TypeScript source
and the tests run on `node --test`.

## Licence

MIT. Part of [Accuren](https://accuren.xyz), which keeps the tax record for
self-custodied tokenized stocks. The archive is the product; the maths is not,
so the maths is public.
