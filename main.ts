// Token Launch Radar: an entry for make.fun's token-radar-01 (Node 22, standard library only).
//
// The program reads the sealed DefiLlama snapshot (default /input/snapshot.json, or --input
// <file|dir>), prices every pre-token protocol with the peer-multiple model in lib/model.ts,
// attaches the farm plan lib/plans.ts writes for it, and produces the hand-in under /output
// (or --output / $MAKEFUN_OUTPUT_DIR):
//
//   board.json    the ranked board: every watchlist slug plus the rankable pre-token field
//   data.js       the same rows as one script, so the dashboard renders with no network
//   dashboard/    this repository's static page, copied
//   screenshots/  this repository's three screenshots, copied
//   dossier.json  buildDossier's summary of the dashboard and screenshots, written last
//
// It is deterministic: no clock, no randomness, no network. Age is measured against the
// snapshot's own as_of date, and every tie in every sort is broken by slug.
//
// Local run:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, computeMultiples, isPreToken, liveRows, parseSnapshot, MODEL_VERSION } from './lib/model.ts';
import type { ScoredRow, Snapshot } from './lib/model.ts';
import { farmPlan } from './lib/plans.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const table = computeMultiples(snapshot);
const scored = buildBoard(snapshot, table);

/** Each protocol's standing among the snapshot's tokenless protocols of its own category. */
function categoryStanding(snap: Snapshot): Map<string, { rank: number; peers: number }> {
  const groups = new Map<string, { slug: string; tvl: number }[]>();
  for (const p of snap.protocols) {
    if (!isPreToken(p)) continue;
    const key = p.category ?? '(none)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ slug: p.slug, tvl: p.tvl_usd });
  }
  const standing = new Map<string, { rank: number; peers: number }>();
  for (const list of groups.values()) {
    list.sort((a, b) => b.tvl - a.tvl || (a.slug < b.slug ? -1 : 1));
    list.forEach((entry, i) => standing.set(entry.slug, { rank: i + 1, peers: list.length }));
  }
  return standing;
}

const standing = categoryStanding(snapshot);

/** A board row with its farm plan attached: the shape board.json and data.js both carry. */
interface BoardRow extends ScoredRow {
  why: string;
  effort: { tier: string; capital_usd: number; gas_usd: number; minutes_per_week: number; hold_days: number };
  farm_steps: string[];
}

const board: BoardRow[] = scored.map((row) => {
  const st = standing.get(row.slug) ?? { rank: 1, peers: 1 };
  const plan = farmPlan(row, { categoryRank: st.rank, categoryPeers: st.peers });
  return { ...row, why: plan.why, effort: plan.effort, farm_steps: plan.steps };
});

/** Why this board is not one the gate will take, or null. Mirrors the gate's seven rows locally. */
function boardIssue(rows: BoardRow[], snap: Snapshot): string | null {
  const slugs = new Set(rows.map((r) => r.slug));
  if (slugs.size !== rows.length) return 'a slug appears twice';
  const known = new Set(snap.protocols.map((p) => p.slug));
  for (const r of rows) if (!known.has(r.slug)) return `${r.slug} is not in the snapshot`;
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows is outside 100..4000`;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.rank !== i + 1) return `row ${i} carries rank ${r.rank}`;
    if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${r.slug} outranks the row above it`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  if (rows.length >= 2 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}

const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

const radar = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  model_version: MODEL_VERSION,
  snapshot_protocols: snapshot.protocols.length,
  watchlist_size: snapshot.watchlist.length,
  board_size: board.length,
  extended_size: board.filter((r) => !r.watchlist).length,
  global_multiple: Math.round(table.global.median * 1e4) / 1e4,
  global_peers: table.global.n,
  rows: board,
  live: liveRows(snapshot),
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(radar)};\n`);

/** Copy a directory tree of regular files into `to`, skipping dot-names at every level. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    if (statSync(src).isDirectory()) {
      copied.push(...copyTree(src, join(to, name)).map((n) => `${name}/${n}`));
    } else if (statSync(src).isFile()) {
      copyFileSync(src, join(to, name));
      copied.push(name);
    }
  }
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${radar.extended_size} beyond the watchlist, ${radar.live.length} live comparables set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, dashboard (${dashFiles.length} files), screenshots (${shots.length} images) and dossier.json\n`,
);
