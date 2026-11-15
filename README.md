# Token Launch Radar

A radar for the protocols that **record no token yet**. From the sealed DefiLlama snapshot
(758 protocols, fetched 2026-11-14), it finds every pre-token protocol worth watching, prices
what its token launch would be worth from the snapshot's own figures, ranks them, and gives
each one a concrete farm plan — presented as a dark, control-room style dashboard that runs
entirely offline.

The board carries **198 rows**: all 40 protocols of the official watchlist (TVL ≥ $50M,
tokenless, not a wrapped/staked/bridged product of a traded token) plus 158 further pre-token
protocols below that floor, found with the same exclusions. Protocols whose token already
trades are never ranked — they are the comparables the prices are read from, and the dashboard
shows them separately.

## Run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to>/snapshot.json
```

Node 22.18+ (TypeScript runs as-is), standard library only, no network, no clock, no
randomness: two runs write byte-identical output. The program writes, under the output dir:

| File | What it is |
| --- | --- |
| `board.json` | The ranked board: rank, implied value, score breakdown, why-line, effort, farm steps |
| `data.js` | The same data as one script, so the page needs no fetch |
| `dashboard/` | The static dashboard (board, per-protocol detail, filters, method) |
| `screenshots/` | The three hand-in screenshots, copied through |
| `dossier.json` | `buildDossier`'s summary of the dashboard and screenshots |

Open `out/dashboard/index.html` from disk or any static host. Routes are hash-based:
`#/board`, `#/board?chain=Ethereum&watch=1`, `#/protocol/<slug>`, `#/method`.

## The ranking model (`radar-2`, peer-multiple)

Every number comes from the snapshot's ten fields. Token-bearing protocols are the yardstick:
their market-cap / TVL ratios are what launches actually came to be worth.

```
multiple = median mcap/TVL of the category's token peers (n ≥ 3),
           else of its category family (n ≥ 3), else the global median,
           clamped to [0.02, 2.00]
implied  = TVL × multiple
           × momentum    1 + clamp(change_7d, −25%, +40%) × 0.008   (unreported: 1.00)
           × longevity   0.90 + 0.25 × min(age_days, 1825) / 1825   (unrecorded: 1.00)
           × breadth     1 + 0.03 × min(chains − 1, 6)
```

- **Why medians with a peer floor:** some categories are one name deep in the snapshot — a
  prediction market trades near 400× its TVL — and no single protocol may price a category.
  Young categories (Risk Curators, Onchain Capital Allocator) borrow their family's median;
  the global median across 144 usable peers here is ×0.169.
- **Why these factors:** momentum rewards protocols gathering the users a launch distributes
  to; longevity prices how long a protocol has run at scale with no token (the deepest
  evidence of a holder base); breadth counts the chains a distribution could reach.
- Each row carries its multiple, its peer count and basis, and all three factors, so any
  number on the page can be re-derived by hand from the snapshot. No name is special-cased.

## Farm plans

Plans are generated per category family (DEX, lending, CDP, perps, yield, curator, basis,
staking, bridge, RWA, chain, insurance, payments, prediction, launchpad, generic) from the
protocol's own record: its first chains set where positions live, its TVL sets the working
capital ($50–$500), its age sets the seasoning window (30–60 days). Every step states a cost
and a time. Watchlist rows earn two extra steps: open a second-chain position, and take part
in the protocol's public governance/community record. Each row also carries a one-paragraph
"why this may pay" tied to its own numbers — its size rank among tokenless peers of its
category, its age, and its 7-day momentum.

A note on language, matching the data: a protocol here **records no token** in DefiLlama's
snapshot. That is the record, not proof none exists, and an implied value is this radar's own
claim about what a launch would be worth if the record stayed as it is — never a prediction
that a token will be issued.

## Layout

- `main.ts` — the program: snapshot in, hand-in out, gate-shaped self-check before writing.
- `lib/model.ts` — parsing, peer multiples, scoring, board selection, comparables.
- `lib/plans.ts` — the farm-plan generator and the why-lines.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored unmodified.
- `dashboard/` — `index.html`, `app.css`, `app.js`: no framework, no fonts, no network.
- `screenshots/` — board, detail and filtered views.

MIT licensed.
