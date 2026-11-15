// Farm plans: what a reader should actually do on each protocol before any launch.
//
// A plan is assembled from the protocol's own record — its category family, its chains, its TVL,
// its age — never from a hand-written list of names. Every family (dex, lending, cdp, perps,
// yield, curator, basis, staking, bridge, rwa, chain, and the rest) carries its own core steps,
// and two phrasing variants rotate by a hash of the slug so neighbouring rows do not read alike.
// Every step states its cost and its time, because a plan without either is a slogan. Watchlist
// rows, the 40 the house named, get the two extra steps: deepen the position, and show up in the
// protocol's governance or community record.

import type { ScoredRow } from './model.ts';

/** What the plan builder needs beyond the row: the protocol's standing among its tokenless peers. */
export interface PlanContext {
  categoryRank: number;
  categoryPeers: number;
}

/** One row's finished plan: the why line, the effort summary, and the steps themselves. */
export interface FarmPlan {
  why: string;
  effort: { tier: string; capital_usd: number; gas_usd: number; minutes_per_week: number; hold_days: number };
  steps: string[];
}

/** "$2.75B", "$513.8M", "$5.02M": the compact money form the plans and the page share. */
export function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n}`;
}

/** Deterministic variant picker: a slug always lands on the same phrasing. */
function variant(slug: string, count: number): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h % count;
}

/** Working capital for one farm position, from the protocol's own TVL: bigger protocols, bigger ticket. */
function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 150;
  if (tvl >= 10_000_000) return 100;
  return 50;
}

/** A realistic gas budget for opening a position, by the chain the position lives on. */
function gasFor(chain: string): number {
  if (chain === 'Ethereum') return 40;
  if (chain === 'Solana') return 2;
  if (chain === 'Tron') return 6;
  return 6;
}

/** How long a position should season, from the protocol's age: younger protocols, longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  if (age < 1095) return 35;
  return 30;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "tracked for 3.4 years, since Jun 2022" — or the honest gap when DefiLlama records no date. */
function ageText(row: ScoredRow): string {
  if (row.age_days === null || row.listed_at === null) return 'with no listing date in its DefiLlama record';
  const years = (row.age_days / 365.25).toFixed(1);
  const [y, m] = row.listed_at.split('-');
  return `tracked for ${years} years, since ${MONTHS[Number(m) - 1]} ${y}`;
}

/** The 7-day momentum sentence, in the direction the snapshot reports. */
function momentumText(row: ScoredRow): string {
  if (row.change_7d === null) return 'The snapshot records no 7-day TVL change for it.';
  const c = row.change_7d;
  if (c >= 5) return `Its TVL grew ${c.toFixed(1)}% in the last 7 days, so interest is compounding now.`;
  if (c <= -5) return `Its TVL fell ${Math.abs(c).toFixed(1)}% in the last 7 days, so size in gradually rather than at once.`;
  return `Its TVL was broadly flat over the last 7 days (${c >= 0 ? '+' : ''}${c.toFixed(1)}%).`;
}

/** The plan family a category farms like. */
function planFamily(category: string | null): string {
  switch (category) {
    case 'Dexs': return 'dex';
    case 'Lending': case 'Uncollateralized Lending': case 'Collateral Markets': return 'lending';
    case 'CDP': case 'CDP Manager': case 'Dual-Token Stablecoin': case 'Algo-Stables': case 'Stablecoin Issuer': case 'Stablecoin Wrapper': return 'cdp';
    case 'Derivatives': case 'Synthetics': case 'Options': case 'Options Vault': case 'Interest Rate Derivatives': return 'perps';
    case 'Yield': case 'Yield Aggregator': case 'Farm': case 'Leveraged Farming': case 'Liquidity Manager': return 'yield';
    case 'Risk Curators': case 'Onchain Capital Allocator': case 'Collateral Management': return 'curator';
    case 'Basis Trading': return 'basis';
    case 'Staking Pool': case 'Restaking': return 'staking';
    case 'Cross Chain Bridge': case 'Bridge': return 'bridge';
    case 'RWA': return 'rwa';
    case 'Chain': return 'chain';
    case 'Insurance': return 'insurance';
    case 'Payments': case 'Crypto Card Issuer': return 'payments';
    case 'Prediction Market': return 'prediction';
    case 'Launchpad': return 'launchpad';
    default: return 'generic';
  }
}

interface Ctx {
  row: ScoredRow;
  name: string;
  chain1: string;
  chain2: string | null;
  cap: number;
  gas: number;
  gas2: number;
  hold: number;
  weeks: number;
}

/** One step: the action, then what it costs and how long it takes. */
function step(text: string, cost: string, time: string): string {
  return `${text} Cost: ${cost}. Time: ${time}.`;
}

/** The opening step: a clean wallet funded on the protocol's first chain. Two phrasings. */
function setupStep(c: Ctx): string {
  const v = variant(c.row.slug, 2);
  const text =
    v === 0
      ? `Create a fresh wallet for ${c.name} alone, back up its seed phrase offline, and fund it on ${c.chain1} with the position capital plus gas money.`
      : `Use one dedicated wallet for ${c.name} (never your main wallet), store its seed phrase on paper, and bridge or buy the funds it needs onto ${c.chain1}.`;
  return step(text, `about $${c.gas} of gas to fund and approve`, '10 minutes, once');
}

/** The closing step: a farm log and a disciplined exit. Two phrasings. */
function recordStep(c: Ctx): string {
  const v = variant(c.row.slug + 'z', 2);
  const text =
    v === 0
      ? `Log every ${c.name} transaction (date, hash, amount) in a farm journal, and re-check the position monthly; if a token or points program is announced, claim only from the link on the protocol's own site.`
      : `Keep a written record of the wallet, the dates and each ${c.name} action so the history can be proven or unwound, and never pay a third party who offers to "claim" a future drop for you.`;
  return step(text, 'nothing', '5 minutes a month');
}

/** The two extra steps a watchlist row earns: deepen, then be visible. */
function deepenSteps(c: Ctx): string[] {
  const second =
    c.chain2 !== null
      ? `Open a second, smaller position on ${c.chain2} (about half the ${c.chain1} size) so the wallet's history spans two of ${c.name}'s chains.`
      : `After four clean weeks, raise the position by half again and extend the weekly cadence rather than opening a second wallet.`;
  const secondGas = c.chain2 !== null ? c.gas2 : c.gas;
  return [
    step(second, `about $${Math.round(c.cap / 2)} more capital and $${secondGas} of gas`, '15 minutes, once'),
    step(
      `Take part in ${c.name}'s public record: vote in its governance or snapshot space where it runs one, answer its user surveys, and keep the wallet that farms it the wallet that votes.`,
      'no capital, a few cents of gas per vote',
      '10 minutes a month',
    ),
  ];
}

/** The family's three core steps: the actions that make a wallet a real user of this kind of protocol. */
function coreSteps(c: Ctx): string[] {
  const { name, chain1, cap, hold } = c;
  const fam = planFamily(c.row.category);
  switch (fam) {
    case 'dex':
      return [
        step(`Swap about $${Math.round(cap / 2)} of the chain's gas token for USDC on ${name} (${chain1}), then swap half back an hour later, so the wallet holds genuine two-way trade history.`, `under $${c.gas} of gas per round trip`, '10 minutes'),
        step(`Add $${cap} of liquidity to ${name}'s deepest blue-chip pool on ${chain1} (gas token / USDC style pair), and leave it untouched for at least ${hold} days.`, `$${cap} of capital, about $${c.gas} of gas`, `${hold} days in position`),
        step(`Repeat one swap round trip every week for ${c.weeks} weeks, varying the size between $25 and $150 so the pattern reads as a person, not a script.`, `about $${Math.max(2, Math.round(c.gas / 2))} of gas a week`, '10 minutes a week'),
      ];
    case 'lending':
      return [
        step(`Supply $${cap} of USDC (or the stablecoin ${name} lends most of) on ${chain1} and leave the deposit open; supplied balance over time is the record that counts.`, `$${cap} of capital, about $${c.gas} of gas`, `${hold} days in position`),
        step(`Borrow about 40% of the supplied value against the deposit, hold it two days, then repay in full; repeat the cycle twice so the wallet shows borrowing, not only supplying.`, 'interest of a few cents a day on the borrowed leg', '10 minutes per cycle'),
        step(`Keep the position's health factor above 2.0 at all times: check it after any sharp market move and top up collateral rather than letting it be liquidated.`, 'no fee to monitor', '5 minutes a week'),
      ];
    case 'cdp':
      return [
        step(`Deposit $${cap} of the chain's gas token as collateral in ${name} on ${chain1} and mint its stablecoin at no more than half the maximum the vault allows (200% collateral or better).`, `$${cap} of capital, about $${c.gas} of gas`, '15 minutes to open'),
        step(`Put the minted stablecoin to work inside ${name}'s own ecosystem (its stability pool or savings vault where offered) instead of swapping it away, and hold for at least ${hold} days.`, 'no extra capital', `${hold} days in position`),
        step(`Repay a slice of the minted debt and mint it again once a month, so the vault shows a living borrower across several snapshots rather than one visit.`, 'a few cents of interest a month', '10 minutes a month'),
      ];
    case 'perps':
      return [
        step(`Deposit $${cap} of USDC as margin on ${name} (${chain1}) and open one small hedged trade: long the gas token with an equal short, or a plain $50 long closed the same day.`, `$${cap} of margin, trading fees under $2`, '20 minutes'),
        step(`Trade a little every week for ${c.weeks} weeks — one or two round trips of $25–$100 — so volume builds steadily instead of in a single burst.`, 'fees of roughly 0.1% per round trip', '15 minutes a week'),
        step(`Where ${name} offers a liquidity or house vault, park $${Math.round(cap / 2)} there for at least ${hold} days; vault depositors are the users protocols most often count separately.`, `$${Math.round(cap / 2)} of capital`, `${hold} days in position`),
      ];
    case 'yield':
      return [
        step(`Deposit $${cap} of USDC or the gas token into ${name}'s flagship vault on ${chain1} and keep the vault shares in the same wallet for at least ${hold} days.`, `$${cap} of capital, about $${c.gas} of gas`, `${hold} days in position`),
        step(`Harvest and re-deposit the yield once a week (or switch on auto-compound where offered) so the wallet shows an active, returning depositor.`, 'a few cents of gas a week', '5 minutes a week'),
        step(`Split a second, smaller deposit across a different vault or asset ${name} offers, so the history covers more than its single front-page product.`, `about $${Math.round(cap / 2)} more capital`, '10 minutes, once'),
      ];
    case 'curator':
      return [
        step(`Read the vault list ${name} curates on ${chain1}, pick one vault whose strategy is plain lending or basis (skip anything you cannot explain), and deposit $${cap} of USDC.`, `$${cap} of capital, about $${c.gas} of gas`, '20 minutes of reading, then the deposit'),
        step(`Hold the vault shares at least ${hold} days; curator vaults reward duration, and reallocations by ${name} happen under your position without any action from you.`, 'no fee beyond the vault\u2019s own terms', `${hold} days in position`),
        step(`Once a month, move a quarter of the position into a second vault ${name} curates, so the wallet appears across its book rather than in a single pool.`, 'a few cents of gas', '10 minutes a month'),
      ];
    case 'basis':
      return [
        step(`Deposit $${cap} of USDC or USDT into ${name}'s basis vault on ${chain1}; the vault runs the hedge, your job is duration, so leave it for at least ${hold} days.`, `$${cap} of capital, about $${c.gas} of gas`, `${hold} days in position`),
        step(`Check the vault's reported funding yield monthly and write it in the farm log; a basis position that quietly compounds is exactly the history to hold.`, 'nothing', '5 minutes a month'),
        step(`Add a second deposit of about $${Math.round(cap / 2)} after the first month rather than all at once, so deposits land in more than one accounting window.`, `$${Math.round(cap / 2)} more capital`, '10 minutes, once'),
      ];
    case 'staking':
      return [
        step(`Stake $${cap} of the chain's native asset through ${name} on ${chain1} and keep the receipt token in the same wallet; do not sell or loop it elsewhere.`, `$${cap} of capital, about $${c.gas} of gas`, `${hold} days in position`),
        step(`Claim and re-stake the staking rewards once a month so the position grows on the record.`, 'a few cents of gas', '5 minutes a month'),
        step(`Note ${name}'s unbonding period in the farm log before you stake, and never stake funds you may need inside that window.`, 'nothing', '5 minutes, once'),
      ];
    case 'bridge':
      return [
        step(`Bridge about $${Math.round(cap / 2)} of USDC through ${name} from ${chain1}${c.chain2 !== null ? ` to ${c.chain2}` : ' to a chain it serves'}, then use the bridged funds in one app on the far side the same day.`, 'bridge fee of roughly 0.1% plus gas', '20 minutes'),
        step(`Bridge a smaller amount back a week later rather than the same day, so both directions sit in different weeks of history.`, 'another small bridge fee', '15 minutes'),
        step(`Repeat one crossing a month for ${Math.max(2, Math.round(c.weeks / 4))} months, varying the asset between USDC and the gas token.`, 'a few dollars of fees a month', '20 minutes a month'),
      ];
    case 'rwa':
      return [
        step(`Complete ${name}'s onboarding on ${chain1} honestly (some RWA issuers require identity checks), then subscribe $${cap} to its shortest-duration yield product.`, `$${cap} of capital, possible KYC time`, '30 minutes to onboard'),
        step(`Hold the position through at least one full interest or redemption cycle (about ${hold} days) instead of redeeming at the first window.`, 'no fee to hold', `${hold} days in position`),
        step(`Reinvest the first payout into the same product, so the record shows a returning holder rather than a one-off subscriber.`, 'the payout itself', '10 minutes, once'),
      ];
    case 'chain':
      return [
        step(`Bridge $${cap} of funds onto ${name}'s chain and keep a small balance of its gas token; a wallet that pays gas there is a resident, not a tourist.`, `$${cap} of capital, one bridge fee`, '20 minutes'),
        step(`Use two of the chain's own apps each week (its main DEX and its main lending market) with small swaps and one open deposit.`, 'a few cents of gas a week on most chains', '15 minutes a week'),
        step(`Hold the deposit and a dust balance for at least ${hold} days, and return monthly even after the first positions are set.`, 'no extra capital', `${hold} days in position`),
      ];
    case 'insurance':
      return [
        step(`Buy one small cover policy from ${name} on ${chain1} (about $${Math.round(cap / 2)} of cover on a large protocol you actually use) and let it run to expiry.`, 'the policy premium, a few dollars', '15 minutes'),
        step(`Stake $${cap} into ${name}'s underwriting or capital pool for at least ${hold} days; capital providers are the users an insurer's token most plausibly rewards.`, `$${cap} of capital`, `${hold} days in position`),
        step(`Renew the policy once when it lapses instead of letting coverage end, so the wallet shows a repeat customer.`, 'a second small premium', '10 minutes, once'),
      ];
    case 'payments':
      return [
        step(`Open a ${name} account or card on ${chain1} if your region is supported, complete its checks, and load about $${Math.round(cap / 2)}.`, `$${Math.round(cap / 2)} loaded, no fee to open in most regions`, '20 minutes'),
        step(`Route one real payment or purchase a week through it for ${c.weeks} weeks; genuine spend is the only history a payments protocol can count.`, 'your ordinary spending, no extra cost', '5 minutes a week'),
        step(`Keep a standing balance of about $${Math.round(cap / 4)} rather than emptying it after each use.`, `$${Math.round(cap / 4)} held`, 'ongoing'),
      ];
    case 'prediction':
      return [
        step(`Fund $${Math.round(cap / 2)} on ${name} (${chain1}) and take one small position ($10–$25) in a liquid, near-dated market you have a view on.`, `$${Math.round(cap / 2)} funded`, '15 minutes'),
        step(`Trade once a week for ${c.weeks} weeks, settling positions as markets resolve instead of abandoning them.`, 'the stake itself, no platform fee on most markets', '10 minutes a week'),
        step(`Keep total exposure under $${cap}: prediction volume farmed beyond your real views loses money faster than any drop repays.`, 'a hard budget, not a fee', 'ongoing discipline'),
      ];
    case 'launchpad':
      return [
        step(`Register the farm wallet on ${name} (${chain1}) and complete whatever holder or whitelist steps its next sale asks for, before any deadline is announced.`, 'a few cents of gas', '15 minutes'),
        step(`Take a small allocation ($${Math.round(cap / 2)} at most) in one sale rather than chasing every launch, and hold the bought tokens at least 30 days.`, `$${Math.round(cap / 2)} of capital`, '30 days in position'),
        step(`Where ${name} weights past participation, keep the same wallet for every sale so the history accumulates in one place.`, 'nothing', 'ongoing'),
      ];
    default:
      return [
        step(`Make ${name}'s core deposit or stake on ${chain1}: $${cap} in, position open, and leave it for at least ${hold} days.`, `$${cap} of capital, about $${c.gas} of gas`, `${hold} days in position`),
        step(`Perform the protocol's main action once a week for ${c.weeks} weeks (a deposit top-up, a claim, a vote or a trade, whichever its app centres on).`, 'a few cents of gas a week', '10 minutes a week'),
        step(`Add one secondary feature of ${name} (a second pool, vault or market) in the second month so the wallet is a user of the protocol, not of one button.`, `about $${Math.round(cap / 2)} more capital`, '15 minutes, once'),
      ];
  }
}

/** Minutes of upkeep a week, by how hands-on the family is. */
function minutesFor(category: string | null): number {
  const fam = planFamily(category);
  if (fam === 'dex' || fam === 'perps' || fam === 'prediction') return 25;
  if (fam === 'chain' || fam === 'bridge') return 20;
  if (fam === 'lending' || fam === 'yield') return 15;
  return 10;
}

/** The whole plan for one row: why it may pay, what it costs to run, and the steps in order. */
export function farmPlan(row: ScoredRow, ctx: PlanContext): FarmPlan {
  const chain1 = row.chains.length > 0 ? row.chains[0]! : 'its primary chain';
  const cap = capitalFor(row.tvl_usd);
  const hold = holdDaysFor(row.age_days);
  const c: Ctx = {
    row,
    name: row.name,
    chain1,
    chain2: row.chains.length > 1 ? row.chains[1]! : null,
    cap,
    gas: gasFor(chain1),
    gas2: gasFor(row.chains.length > 1 ? row.chains[1]! : chain1),
    hold,
    weeks: Math.max(4, Math.round(hold / 7)),
  };
  const steps = [setupStep(c), ...coreSteps(c)];
  if (row.watchlist) steps.push(...deepenSteps(c));
  steps.push(recordStep(c));

  const catLabel = row.category ?? 'uncategorised';
  const rankBit =
    ctx.categoryPeers > 1
      ? ` It is the #${ctx.categoryRank} largest of ${ctx.categoryPeers} tokenless ${catLabel} protocols in the snapshot, across ${row.chains.length === 0 ? 'no recorded chain' : row.chains.length === 1 ? '1 chain' : `${row.chains.length} chains`}, ${ageText(row)}.`
      : ` It stands across ${row.chains.length === 1 ? '1 chain' : `${row.chains.length} chains`}, ${ageText(row)}.`;
  const why =
    `${row.name} records no token in the DefiLlama snapshot yet holds ${money(row.tvl_usd)} of TVL.` +
    rankBit +
    ` ${momentumText(row)}` +
    ` If a launch comes, the wallets with long, ordinary, on-chain history are the ones distribution rules usually count, and this plan builds exactly that record.`;

  const minutes = minutesFor(row.category);
  const tier = cap >= 500 ? 'Committed' : cap >= 150 ? 'Standard' : 'Light';
  return {
    why,
    effort: { tier, capital_usd: cap, gas_usd: c.gas, minutes_per_week: minutes, hold_days: hold },
    steps,
  };
}
