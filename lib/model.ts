// The radar's value model: a sealed DefiLlama snapshot in, a ranked pre-token board out.
//
// Every number comes from the snapshot's own ten fields. Protocols that already record a token are
// the comparables: their market-cap / TVL ratios are what a launch is worth elsewhere. A pre-token
// protocol's implied value is its TVL priced at the multiple its category's token-bearing peers
// actually trade at, adjusted by three factors the snapshot also carries: its 7-day TVL momentum,
// how long it has run with no token, and how many chains it spans.
//
//   multiple   = median mcap/TVL of the category's token peers (n >= 3), else of its family
//                (n >= 3), else of all 144 token peers; clamped to [0.02, 2.00] so a one-name
//                category cannot inherit an outlier (the snapshot holds a 400x prediction market)
//   base       = tvl_usd x multiple
//   momentum   = 1 + clamp(change_7d, -25, +40) x 0.008        (unreported change: 1.00)
//   longevity  = 0.90 + 0.25 x min(age_days, 1825) / 1825      (unrecorded age: 1.00)
//   breadth    = 1 + 0.03 x min(chains - 1, 6)
//   implied    = round(base x momentum x longevity x breadth), at least $1
//
// No protocol's name is ever special-cased: one function prices every row, and each row carries
// its multiple, its peer count and its three factors so the arithmetic can be checked by hand.

/** One protocol of the sealed snapshot: exactly the ten fields the file carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label, stated on the dashboard and in the README. */
export const MODEL_VERSION = 'radar-2 (peer-multiple)';

/** The most rows the board carries: every rankable pre-token protocol, capped for a readable page. */
export const BOARD_CAP = 240;

/** A resolved peer multiple: the number, where it came from, and how many peers stand behind it. */
export interface Multiple {
  value: number;
  basis: string;
  peers: number;
}

/** Category families: categories too young to have three token peers borrow their family's median. */
const FAMILIES: Record<string, string[]> = {
  'Trading venues': ['Dexs', 'Derivatives', 'Synthetics', 'Options', 'Options Vault', 'Interest Rate Derivatives', 'Prediction Market'],
  'Credit & lending': ['Lending', 'Uncollateralized Lending', 'CDP', 'CDP Manager', 'Collateral Markets'],
  'Yield & allocation': ['Yield', 'Yield Aggregator', 'Risk Curators', 'Onchain Capital Allocator', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Basis Trading', 'Collateral Management'],
  'Staking & restaking': ['Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool', 'Restaked BTC', 'Anchor BTC', 'Decentralized BTC'],
  'Bridges & chains': ['Bridge', 'Cross Chain Bridge', 'Canonical Bridge', 'Chain'],
  'Tokenised assets': ['RWA', 'Indexes', 'Stablecoin Issuer', 'Dual-Token Stablecoin', 'Algo-Stables', 'Stablecoin Wrapper', 'Reserve Currency'],
};

const FAMILY_OF = new Map<string, string>();
for (const [family, cats] of Object.entries(FAMILIES)) for (const c of cats) FAMILY_OF.set(c, family);

/** The family a category belongs to; unlisted categories form the services family. */
export function familyOf(category: string | null): string {
  if (category === null) return 'Services & other';
  return FAMILY_OF.get(category) ?? 'Services & other';
}

/** The statistical median of a non-empty list, computed on a sorted copy. */
function median(values: number[]): number {
  const a = [...values].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 === 1 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

const MULT_FLOOR = 0.02;
const MULT_CAP = 2.0;
const MIN_PEERS = 3;

/** Every peer multiple the snapshot supports: by category, by family, and one global figure. */
export interface MultipleTable {
  byCategory: Map<string, { n: number; median: number }>;
  byFamily: Map<string, { n: number; median: number }>;
  global: { n: number; median: number };
  resolve: (category: string | null) => Multiple;
}

/** Build the multiple table from the snapshot's token-bearing protocols (mcap and TVL both present). */
export function computeMultiples(snapshot: Snapshot): MultipleTable {
  const catRatios = new Map<string, number[]>();
  const famRatios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const cat = p.category ?? '(none)';
    if (!catRatios.has(cat)) catRatios.set(cat, []);
    catRatios.get(cat)!.push(ratio);
    const fam = familyOf(p.category);
    if (!famRatios.has(fam)) famRatios.set(fam, []);
    famRatios.get(fam)!.push(ratio);
  }
  const byCategory = new Map<string, { n: number; median: number }>();
  for (const [cat, arr] of catRatios) byCategory.set(cat, { n: arr.length, median: median(arr) });
  const byFamily = new Map<string, { n: number; median: number }>();
  for (const [fam, arr] of famRatios) byFamily.set(fam, { n: arr.length, median: median(arr) });
  const global = { n: all.length, median: median(all) };
  const clamp = (v: number): number => Math.min(MULT_CAP, Math.max(MULT_FLOOR, v));
  return {
    byCategory,
    byFamily,
    global,
    resolve(category: string | null): Multiple {
      const cat = category ?? '(none)';
      const c = byCategory.get(cat);
      if (c !== undefined && c.n >= MIN_PEERS) {
        return { value: clamp(c.median), basis: `category median of ${c.n} token peers in ${category}`, peers: c.n };
      }
      const fam = familyOf(category);
      const f = byFamily.get(fam);
      if (f !== undefined && f.n >= MIN_PEERS) {
        return { value: clamp(f.median), basis: `family median of ${f.n} token peers in ${fam.toLowerCase()} (category has ${c?.n ?? 0} of its own)`, peers: f.n };
      }
      return { value: clamp(global.median), basis: `global median of ${global.n} token peers (no category or family median stands)`, peers: global.n };
    },
  };
}

const DAY_MS = 86_400_000;

/** Whole days from a protocol's listing day to the snapshot's as-of day; null when either is absent. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The three adjustment factors and the implied value one protocol earns, broken out for display. */
export interface Scored {
  multiple: Multiple;
  base_value_usd: number;
  momentum: number;
  longevity: number;
  breadth: number;
  age_days: number | null;
  implied_value_usd: number;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Price one pre-token protocol under the model. The same function prices every row. */
export function scoreProtocol(p: SnapshotProtocol, asOf: string, table: MultipleTable): Scored {
  const multiple = table.resolve(p.category);
  const base = p.tvl_usd * multiple.value;
  const momentum = p.change_7d === null ? 1 : 1 + Math.min(40, Math.max(-25, p.change_7d)) * 0.008;
  const age = ageDays(asOf, p.listed_at);
  const longevity = age === null ? 1 : 0.9 + 0.25 * (Math.min(age, 1825) / 1825);
  const breadth = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 6);
  const implied = Math.max(1, Math.round(base * momentum * longevity * breadth));
  return {
    multiple,
    base_value_usd: Math.round(base),
    momentum: round4(momentum),
    longevity: round4(longevity),
    breadth: round4(breadth),
    age_days: age,
    implied_value_usd: implied,
  };
}

/** Whether a protocol records no token at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** The house's own exclusions, mirrored for rows below the floor: categories that are a wrapped,
 *  staked, bridged or exchange product of something that already trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a pre-token protocol below the floor may be ranked: not a derivative of a traded token. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/** One row of the board before its farm plan is attached. */
export interface ScoredRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  base_value_usd: number;
  multiple: number;
  multiple_basis: string;
  peers: number;
  factors: { momentum: number; longevity: number; breadth: number };
}

/** The board's rows, ranked: every watchlist slug, plus every rankable pre-token protocol the cap holds. */
export function buildBoard(snapshot: Snapshot, table: MultipleTable): ScoredRow[] {
  const watch = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watch.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => ({ p, s: scoreProtocol(p, snapshot.as_of, table) }));
  scored.sort(
    (a, b) =>
      b.s.implied_value_usd - a.s.implied_value_usd ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.slice(0, BOARD_CAP).map(({ p, s }, i) => ({
    rank: i + 1,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: s.age_days,
    watchlist: watch.has(p.slug),
    implied_value_usd: s.implied_value_usd,
    base_value_usd: s.base_value_usd,
    multiple: round4(s.multiple.value),
    multiple_basis: s.multiple.basis,
    peers: s.multiple.peers,
    factors: { momentum: s.momentum, longevity: s.longevity, breadth: s.breadth },
  }));
}

/** A live-token protocol for the comparables view: it already trades, so it is never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
  change_7d: number | null;
}

/** The largest token-bearing protocols, the market's own prices the multiples are read from. */
export function liveRows(snapshot: Snapshot, cap = 24): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
    .slice(0, cap)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: round4(p.mcap_usd! / p.tvl_usd),
      change_7d: p.change_7d,
    }));
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** The snapshot out of a file's text, refused unless it carries the documented shape. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}
