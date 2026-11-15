/* Token Launch Radar — renders window.RADAR (written by main.ts from the sealed snapshot)
   into three hash-routed views: the board, one protocol's detail, and the method.
   No network, no framework: every route works from file:// and any static host. */
'use strict';

const app = document.getElementById('app');
const R = window.RADAR;

if (!R) {
  app.innerHTML = '<div class="wrap"><p class="empty">No radar data found beside this page. Run <b>node main.ts</b> first: it writes data.js from the sealed snapshot.</p></div>';
  throw new Error('window.RADAR missing');
}

const rows = R.rows;
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const maxIv = Math.max(...rows.map((r) => r.implied_value_usd));

/* ---------- formatting ---------- */

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function money(n) {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n}`;
}
const fullMoney = (n) => `$${n.toLocaleString('en-US')}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateFmt(iso) {
  if (!iso) return 'not recorded';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]} ${y}`;
}
function ageShort(days) {
  if (days === null || days === undefined) return '—';
  if (days < 90) return `${days}d`;
  return `${(days / 365.25).toFixed(1)}y`;
}
function changePill(c) {
  if (c === null || c === undefined) return '<span class="pill">7d —</span>';
  const cls = c > 0.05 ? 'pos' : c < -0.05 ? 'neg' : '';
  const arrow = c > 0.05 ? '▲' : c < -0.05 ? '▼' : '·';
  return `<span class="pill ${cls}">${arrow} ${c >= 0 ? '+' : ''}${c.toFixed(1)}%</span>`;
}
const badge = (r) =>
  r.watchlist ? '<span class="badge wl">Watchlist</span>' : '<span class="badge ext">Radar find</span>';
const chainText = (chains) =>
  chains.length === 0 ? '—' : chains.slice(0, 3).join(', ') + (chains.length > 3 ? ` +${chains.length - 3}` : '');

/* ---------- chrome ---------- */

function chrome(active, inner) {
  return `
  <div class="wrap">
    <header class="top">
      <div class="scope" aria-hidden="true"></div>
      <div class="brand">
        <h1>Token Launch <span class="thin">Radar</span></h1>
        <p>Protocols that record no token yet, ranked by what their launch would be worth — priced from the snapshot's own token peers, each with a plan to farm it.</p>
      </div>
      <nav class="tabs">
        <a href="#/board" class="${active === 'board' ? 'on' : ''}">Board</a>
        <a href="#/method" class="${active === 'method' ? 'on' : ''}">Method</a>
      </nav>
    </header>
    <div class="stats">
      <div class="stat"><b>${R.snapshot_protocols}</b><span>protocols scanned</span></div>
      <div class="stat warn"><b>${R.watchlist_size}</b><span>official watchlist</span></div>
      <div class="stat hot"><b>${R.board_size}</b><span>ranked pre-token</span></div>
      <div class="stat"><b>${R.extended_size}</b><span>finds below the floor</span></div>
      <div class="stat"><b>${esc(R.as_of)}</b><span>snapshot date</span></div>
    </div>
    ${inner}
    <footer class="bot">
      Source: ${esc(R.source)}. A protocol here <i>records no token</i> in that snapshot; that is DefiLlama's
      record, not proof none exists. An implied value is this radar's own model output — what a launch would be
      worth if the protocol's record stayed as it is — never a prediction that a token will be issued.
      Model ${esc(R.model_version)}. The page renders entirely from local data; nothing is fetched.
    </footer>
  </div>`;
}

/* ---------- routing ---------- */

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const params = new URLSearchParams(qs || '');
  if (parts[0] === 'protocol' && parts[1]) return { view: 'protocol', slug: decodeURIComponent(parts[1]) };
  if (parts[0] === 'method') return { view: 'method' };
  return {
    view: 'board',
    q: params.get('q') || '',
    chain: params.get('chain') || '',
    category: params.get('category') || '',
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'value',
  };
}

function boardHash(st) {
  const p = new URLSearchParams();
  if (st.q) p.set('q', st.q);
  if (st.chain) p.set('chain', st.chain);
  if (st.category) p.set('category', st.category);
  if (st.watch) p.set('watch', '1');
  if (st.sort && st.sort !== 'value') p.set('sort', st.sort);
  const s = p.toString();
  return `#/board${s ? `?${s}` : ''}`;
}

/* ---------- board ---------- */

let boardState = null;

function filteredRows(st) {
  const q = st.q.trim().toLowerCase();
  let out = rows.filter((r) => {
    if (st.watch && !r.watchlist) return false;
    if (st.chain && !r.chains.includes(st.chain)) return false;
    if (st.category && (r.category || '') !== st.category) return false;
    if (q && !`${r.name} ${r.slug} ${r.category || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const by = {
    value: (a, b) => a.rank - b.rank,
    tvl: (a, b) => b.tvl_usd - a.tvl_usd,
    change: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
    age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
    name: (a, b) => (a.name < b.name ? -1 : 1),
  }[st.sort] || ((a, b) => a.rank - b.rank);
  return out.sort(by);
}

function rowHtml(r) {
  const w = Math.max(2, Math.sqrt(r.implied_value_usd / maxIv) * 100);
  const top = r.rank <= 3 ? ` top${r.rank}` : '';
  return `<tr data-slug="${esc(r.slug)}" class="${top.trim()}">
    <td class="rank">#${r.rank}</td>
    <td class="name"><span class="pname">${esc(r.name)}</span><span class="cat">${esc(r.category || 'Uncategorised')}</span></td>
    <td class="iv"><span class="v">${money(r.implied_value_usd)}</span><div class="bar"><i style="width:${w.toFixed(1)}%"></i></div></td>
    <td class="num">${money(r.tvl_usd)}</td>
    <td>${changePill(r.change_7d)}</td>
    <td class="num">${ageShort(r.age_days)}</td>
    <td class="num">×${r.multiple.toFixed(2)}</td>
    <td class="chains">${esc(chainText(r.chains))}</td>
    <td>${badge(r)}</td>
  </tr>`;
}

function renderTable() {
  const list = filteredRows(boardState);
  const body = document.getElementById('tbody');
  const count = document.getElementById('count');
  if (!body) return;
  body.innerHTML = list.length
    ? list.map(rowHtml).join('')
    : '<tr><td colspan="9" class="empty">No protocol matches this sweep. Loosen the filters.</td></tr>';
  count.textContent = `${list.length} of ${rows.length} on screen`;
}

function renderBoard(st) {
  boardState = st;
  const chainCounts = new Map();
  for (const r of rows) for (const c of r.chains) chainCounts.set(c, (chainCounts.get(c) || 0) + 1);
  const chainOpts = [...chainCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([c, n]) => `<option value="${esc(c)}" ${st.chain === c ? 'selected' : ''}>${esc(c)} (${n})</option>`)
    .join('');
  const catOpts = [...new Set(rows.map((r) => r.category).filter(Boolean))]
    .sort()
    .map((c) => `<option value="${esc(c)}" ${st.category === c ? 'selected' : ''}>${esc(c)}</option>`)
    .join('');
  const sortOpts = [
    ['value', 'Implied value'],
    ['tvl', 'TVL'],
    ['change', '7-day change'],
    ['age', 'Age (longest tokenless)'],
    ['name', 'Name'],
  ]
    .map(([v, label]) => `<option value="${v}" ${st.sort === v ? 'selected' : ''}>${label}</option>`)
    .join('');

  app.innerHTML = chrome(
    'board',
    `
    <div class="controls">
      <input type="search" id="fq" placeholder="Search name, slug, category…" value="${esc(st.q)}" aria-label="Search">
      <select id="fchain" aria-label="Chain"><option value="">All chains</option>${chainOpts}</select>
      <select id="fcat" aria-label="Category"><option value="">All categories</option>${catOpts}</select>
      <select id="fsort" aria-label="Sort">${sortOpts}</select>
      <label class="chk"><input type="checkbox" id="fwatch" ${st.watch ? 'checked' : ''}> Watchlist only</label>
      <span class="count" id="count"></span>
    </div>
    <table class="board">
      <thead><tr>
        <th class="rank">Rank</th><th>Protocol</th><th>Implied value</th><th>TVL</th><th>7 days</th>
        <th>Age</th><th>Peer ×</th><th>Chains</th><th>Set</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table>`,
  );

  const sync = () => {
    history.replaceState(null, '', boardHash(boardState));
    renderTable();
  };
  document.getElementById('fq').addEventListener('input', (e) => { boardState.q = e.target.value; sync(); });
  document.getElementById('fchain').addEventListener('change', (e) => { boardState.chain = e.target.value; sync(); });
  document.getElementById('fcat').addEventListener('change', (e) => { boardState.category = e.target.value; sync(); });
  document.getElementById('fsort').addEventListener('change', (e) => { boardState.sort = e.target.value; sync(); });
  document.getElementById('fwatch').addEventListener('change', (e) => { boardState.watch = e.target.checked; sync(); });
  document.getElementById('tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = `#/protocol/${encodeURIComponent(tr.dataset.slug)}`;
  });
  renderTable();
}

/* ---------- detail ---------- */

function factorRow(label, f, lo, hi, note) {
  const pct = (x) => ((x - lo) / (hi - lo)) * 100;
  const left = Math.min(pct(1), pct(f));
  const width = Math.max(2, Math.abs(pct(f) - pct(1)));
  return `<div class="frow">
    <div class="fl">${label}</div>
    <div class="fbar"><i style="left:${left.toFixed(1)}%;width:${width.toFixed(1)}%"></i></div>
    <div class="fv">×${f.toFixed(3)}</div>
    </div>
    <div class="frow" style="border-bottom:none;padding-top:0"><div></div><div class="dim" style="font-size:12px">${note}</div><div></div></div>`;
}

function stepHtml(s) {
  const m = /^(.*) Cost: (.+)\. Time: (.+)\.$/s.exec(s.trim());
  if (!m) return `<li>${esc(s)}</li>`;
  return `<li>${esc(m[1])}<span class="tags"><span class="tag">Cost · ${esc(m[2])}</span><span class="tag time">Time · ${esc(m[3])}</span></span></li>`;
}

function renderProtocol(slug) {
  const r = bySlug.get(slug);
  if (!r) {
    app.innerHTML = chrome('board', `<p class="empty">No protocol “${esc(slug)}” is on this board. <a href="#/board">Back to the board</a>.</p>`);
    return;
  }
  const prev = bySlug.get(rows[r.rank - 2]?.slug);
  const next = bySlug.get(rows[r.rank]?.slug);
  const baseW = Math.min(100, (r.base_value_usd / r.implied_value_usd) * 100);
  app.innerHTML = chrome(
    'board',
    `
    <a class="back" href="#/board">← Back to the board</a>
    <div class="detail-head">
      <h2>${esc(r.name)}</h2>
      <span class="cat">#${r.rank} of ${rows.length} · ${esc(r.category || 'Uncategorised')}</span>
      ${badge(r)}
    </div>
    <div class="chiprow">${r.chains.map((c) => `<span class="chip">${esc(c)}</span>`).join('') || '<span class="chip">no chains recorded</span>'}</div>

    <div class="tiles">
      <div class="tile hero"><span>Implied launch value</span><b>${fullMoney(r.implied_value_usd)}</b><small>TVL priced at its peers' multiple, adjusted below</small></div>
      <div class="tile"><span>TVL (snapshot)</span><b>${fullMoney(r.tvl_usd)}</b><small>as of ${esc(R.as_of)}</small></div>
      <div class="tile"><span>Peer multiple</span><b>×${r.multiple.toFixed(3)}</b><small>${esc(r.multiple_basis)}</small></div>
      <div class="tile"><span>7-day TVL change</span><b>${r.change_7d === null ? '—' : `${r.change_7d >= 0 ? '+' : ''}${r.change_7d.toFixed(1)}%`}</b><small>momentum factor ×${r.factors.momentum.toFixed(3)}</small></div>
      <div class="tile"><span>Running tokenless</span><b>${r.age_days === null ? '—' : `${r.age_days} days`}</b><small>listed ${dateFmt(r.listed_at)}</small></div>
      <div class="tile"><span>Chain breadth</span><b>${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}</b><small>breadth factor ×${r.factors.breadth.toFixed(3)}</small></div>
    </div>

    <div class="panel">
      <h3>Why it is on the radar</h3>
      <p>${esc(r.why)}</p>
    </div>

    <div class="panel">
      <h3>How the number is built</h3>
      <div class="frow">
        <div class="fl">Base · TVL × peer multiple</div>
        <div class="fbar"><i class="base" style="left:0;width:${baseW.toFixed(1)}%"></i></div>
        <div class="fv">${money(r.base_value_usd)}</div>
      </div>
      ${factorRow('Momentum · 7-day TVL', r.factors.momentum, 0.7, 1.4, 'Growth is rewarded, collapse is discounted: 1 + clamp(change, −25%, +40%) × 0.008. Unreported change scores neutral.')}
      ${factorRow('Longevity · time tokenless', r.factors.longevity, 0.85, 1.2, 'The longer a protocol has run at scale with no token, the deeper the holder base a launch would meet: 0.90 + 0.25 × age / 5 years.')}
      ${factorRow('Breadth · chains spanned', r.factors.breadth, 0.95, 1.25, 'Each extra chain widens the future distribution surface: 1 + 0.03 × extra chains, capped at six.')}
      <p class="dim">Implied value = base × momentum × longevity × breadth, rounded to whole dollars. Every input is a field of the sealed snapshot; the same formula prices every row.</p>
    </div>

    <div class="panel">
      <h3>Farm plan · ${esc(r.effort.tier)} effort</h3>
      <div class="effort">
        <div class="e"><span>Working capital</span><b>$${r.effort.capital_usd}</b></div>
        <div class="e"><span>Gas to open</span><b>~$${r.effort.gas_usd}</b></div>
        <div class="e"><span>Upkeep</span><b>${r.effort.minutes_per_week} min / week</b></div>
        <div class="e"><span>Seasoning</span><b>${r.effort.hold_days} days</b></div>
      </div>
      <ol class="steps">${r.farm_steps.map(stepHtml).join('')}</ol>
      <p class="dim">Costs are working estimates for one wallet on the protocol's first chain, stated so the plan can be budgeted; capital stays yours and position risk is real. Never farm with funds you cannot leave in place for the full seasoning window.</p>
    </div>

    <div class="prevnext">
      <span>${prev ? `<a href="#/protocol/${encodeURIComponent(prev.slug)}">← #${prev.rank} ${esc(prev.name)}</a>` : ''}</span>
      <span>${next ? `<a href="#/protocol/${encodeURIComponent(next.slug)}">#${next.rank} ${esc(next.name)} →</a>` : ''}</span>
    </div>`,
  );
}

/* ---------- method ---------- */

function renderMethod() {
  const live = (R.live || [])
    .map(
      (l) => `<tr>
        <td>${esc(l.name)} <span class="dim">${esc(l.symbol || '')}</span></td>
        <td class="dim">${esc(l.category || '—')}</td>
        <td class="num">${money(l.tvl_usd)}</td>
        <td class="num">${money(l.mcap_usd)}</td>
        <td class="num">×${l.ratio.toFixed(2)}</td>
      </tr>`,
    )
    .join('');
  app.innerHTML = chrome(
    'method',
    `
    <div class="panel">
      <h3>The value model</h3>
      <div class="formula">
        <span class="k">multiple</span> = median market-cap / TVL of the category's token peers (n ≥ 3),<br>
        &nbsp;&nbsp;else of its category family, else the global median — clamped to [0.02, 2.00]<br>
        <span class="k">implied</span> = TVL × multiple × momentum × longevity × breadth
      </div>
      <p>The snapshot's token-bearing protocols are the only honest yardstick a sealed dataset offers: they are what
      launches in each category actually came to be worth against the TVL they held. The global median across all
      ${R.global_peers} usable peers here is <b>×${Number(R.global_multiple).toFixed(3)}</b>. A category needs three peers
      before its own median is trusted — one prediction market trades near 400× its TVL, and no single name is allowed
      to price a whole category. The clamp says the same thing at the edges: no launch is priced above twice its TVL
      or below a fiftieth of it.</p>
    </div>
    <div class="method-grid">
      <div class="panel">
        <h3>The three adjustments</h3>
        <p><b>Momentum</b> — 1 + clamp(7-day change, −25%, +40%) × 0.008. A protocol gathering TVL is gathering the
        users a launch distributes to; one bleeding TVL is discounted, never below ×0.80.</p>
        <p><b>Longevity</b> — 0.90 + 0.25 × (age in days / 1825). Years run at scale with no token is the strongest
        evidence in the file that a holder base exists. Unrecorded ages score neutral.</p>
        <p><b>Breadth</b> — 1 + 0.03 per extra chain, capped at six. More chains, more wallets a distribution can reach.</p>
      </div>
      <div class="panel">
        <h3>Who is on the board</h3>
        <p>Every one of the ${R.watchlist_size} official watchlist protocols (TVL at or above ${money(R.floor_usd)},
        recording no token, and not a wrapped, staked or bridged product of a traded token) — plus
        ${R.extended_size} more pre-token protocols below that floor, found by the same exclusions. Protocols whose
        token already trades are never ranked; they are the comparables below. Versioned pools, exchange products and
        wrapped or staked derivatives of traded tokens are excluded on the same reasoning as the house's own rule.</p>
        <p class="dim">Ranks are the model's claim, in whole dollars, and no two rows share a formula exception:
        there is no hand-tuned list anywhere in the program.</p>
      </div>
    </div>
    <div class="panel">
      <h3>Already live — the comparables, kept apart</h3>
      <p class="dim">The largest token-bearing protocols in the same snapshot. Their market caps are the market's own
      verdicts, and their ratios are what the multiples above are read from. They are shown for scale and never ranked.</p>
      <table class="mini">
        <thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>MCap / TVL</th></tr></thead>
        <tbody>${live}</tbody>
      </table>
    </div>`,
  );
}

/* ---------- go ---------- */

function route() {
  const r = parseHash();
  if (r.view === 'protocol') renderProtocol(r.slug);
  else if (r.view === 'method') renderMethod();
  else renderBoard(r);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
