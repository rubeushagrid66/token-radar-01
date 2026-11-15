// Token Radar, radar-2. Reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, the filters, a per-protocol detail panel with the model's own inputs and the farm
// plan. No network: every byte it shows is in data.js.
//
// The model in two functions: impliedOf recomputes a row from the snapshot figures and checks the
// number board.json carries, and farmSteps derives the plan from category, chains, TVL and age, the
// same derivation main.ts writes to board.json. No protocol name is special-cased anywhere.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', mintvl: 0, watchonly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // radar-2: base is a power law (value grows slower than TVL), growth is asymmetric (downside
  // costs twice upside), maturity is logarithmic and saturates, breadth is a small chain nudge.
  function impliedOf(row, model) {
    var base = model.base_anchor_usd * Math.pow(row.tvl_usd / model.base_anchor_tvl_usd, model.base_power);
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    g = Math.min(model.growth_cap, Math.max(model.growth_floor, g));
    var gm = g >= 0 ? 1 + (g / 100) * model.growth_up_weight : 1 + (g / 100) * model.growth_down_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var mm = model.maturity_floor + model.maturity_range * (Math.log(1 + Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_year_days) / Math.log(5));
    var bm = 1 + model.breadth_per_chain * Math.min((row.chains || []).length, model.breadth_max_chains);
    return { implied: Math.max(1, Math.round(base * gm * mm * bm)), base: Math.round(base), growth: g, growthMult: gm, maturityMult: mm, breadthMult: bm };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan, the same derivation main.ts writes to board.json.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 2e9) return 300;
    if (p.tvl_usd >= 5e8) return 200;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 90) return 90;
    if (age < 365) return 60;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('risk curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('curator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.';
    if (c.indexOf('basis trading') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s basis vault on " + chain + ' and hold the position.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the loan open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('yield aggregator') >= 0 || c.indexOf('yield') >= 0) return 'Deposit $' + capital + " into " + name + "'s highest-TVL vault on " + chain + ' and keep the shares.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of the yield-bearing asset ' + name + ' issues on ' + chain + ' and hold it.';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged trade.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking pool') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt token.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of stablecoins through ' + name + ' on ' + chain + ' and hold the balance.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and take one position on a ' + name + ' market that runs at least a week.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + " into " + name + "'s main farm on " + chain + ' and keep the stake.';
    if (c.indexOf('chain') >= 0) return 'Use $' + capital + " of the chain's gas token in " + name + "'s app on " + chain + ' and keep it active.';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Spend $' + capital + ' through ' + name + ' on ' + chain + ' and keep the card or account active.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold the position.';
    if (c.indexOf('otc') >= 0 || c.indexOf('governance') >= 0) return 'Place a $' + capital + ' order through ' + name + ' on ' + chain + ' and keep the account funded.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var steps = [
      { text: 'Open a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper, never in a chat or a screenshot.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 200 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Do one qualifying action every week, such as a deposit, a borrow, a swap, a vote or a claim, so the wallet stays active in every snapshot window.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days, so the activity is counted in more than one snapshot instead of a single one.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes there, never from a link in a chat or a search result.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the chain, the dates and every transaction in a farm log, so you can repeat the position or unwind it without guessing.', cost: 'nothing but the log', time: '5 minutes' }
    ];
    if (p.chains && p.chains.length > 1) {
      steps.push({ text: 'Repeat the core action on ' + p.chains[1] + ' with half the capital, so the wallet is active on a second chain the protocol already runs on.', cost: '$' + Math.round(capital / 2) + ' of capital and about $4 of gas', time: '15 minutes' });
    }
    return steps.map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('mintvl')) state.mintvl = parseInt(params.get('mintvl'), 10) || 0;
    if (params.get('watch') === '1') state.watchonly = true;
    if (params.get('tab') === 'live') state.tab = 'live';
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.mintvl) params.set('mintvl', String(state.mintvl));
    if (state.watchonly) params.set('watch', '1');
    if (state.tab === 'live') params.set('tab', 'live');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.mintvl) return false;
      if (state.watchonly && !r.watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'rank') { av = a.rank; bv = b.rank; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function fillStatic() {
    document.getElementById('stat-asof').textContent = DATA.as_of;
    document.getElementById('stat-watch').textContent = DATA.watchlist_size + ' / ' + DATA.watchlist_size;
    document.getElementById('stat-rows').textContent = String(DATA.board_size);
    document.getElementById('stat-early').textContent = String(DATA.early_size);
    document.getElementById('stat-live').textContent = String(DATA.live_size);
    document.getElementById('source-line').textContent = 'Source: ' + DATA.source + ' · floor $' + Math.round(DATA.floor_usd / 1e6) + 'M · model ' + DATA.model_version + ' · ' + DATA.board_size + ' pre-token rows, ' + DATA.live_size + ' live-token protocols set aside';
    var m = DATA.model;
    document.getElementById('formula').textContent =
      'base = $' + (m.base_anchor_usd / 1e6) + 'M x (tvl_usd / $' + (m.base_anchor_tvl_usd / 1e9) + 'B) ^ ' + m.base_power +
      '   |   growth = clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + '), up x ' + m.growth_up_weight + ', down x ' + m.growth_down_weight +
      '   |   maturity = ' + m.maturity_floor + ' + ' + m.maturity_range + ' x ln(1 + min(age, ' + m.maturity_days + ') / ' + m.maturity_year_days + ') / ln(5)' +
      '   |   breadth = 1 + ' + m.breadth_per_chain + ' x min(chains, ' + m.breadth_max_chains + ')' +
      '   |   implied = round(base x growth x maturity x breadth)';
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var catSel = document.getElementById('category');
    cats.forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c;
      if (c === state.category) o.selected = true;
      catSel.appendChild(o);
    });
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var chainSel = document.getElementById('chain');
    chains.forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c;
      if (c === state.chain) o.selected = true;
      chainSel.appendChild(o);
    });
  }

  function sortHeader(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' v' : ' ^') : '';
    return el('th', { scope: 'col' },
      el('button', { type: 'button', 'data-sort': key, onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } }, label + arrow)
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    var panel = document.getElementById('table-panel');
    var empty = document.getElementById('empty');
    var table = document.getElementById('board-table');
    var tbody = document.getElementById('tbody');
    var thead = table.querySelector('thead tr');
    thead.textContent = '';
    thead.appendChild(sortHeader('rank', 'Rank'));
    thead.appendChild(sortHeader('name', 'Protocol'));
    thead.appendChild(sortHeader('tvl', 'TVL'));
    thead.appendChild(sortHeader('growth', '7d'));
    thead.appendChild(sortHeader('age', 'Age'));
    thead.appendChild(sortHeader('implied', 'Implied value'));
    thead.appendChild(el('th', { scope: 'col', text: 'Token' }));
    tbody.textContent = '';
    var count = document.getElementById('count');
    count.textContent = list.length + ' rows shown';
    if (list.length === 0) { table.style.display = 'none'; empty.hidden = false; return; }
    table.style.display = ''; empty.hidden = true;
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var nameCell = el('td', null, el('div', { class: 'name' },
        el('span', null, el('b', { text: r.name }), r.watchlist ? el('span', { class: 'watch-tag', text: 'WATCH' }) : null),
        el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
      ));
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        'data-top': r.rank <= 3 ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, el('span', { class: 'rank-badge num', text: String(r.rank) })),
        nameCell,
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'pill', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
  }

  function liveTable() {
    var panel = document.getElementById('table-panel');
    var empty = document.getElementById('empty');
    var table = document.getElementById('board-table');
    var tbody = document.getElementById('tbody');
    var thead = table.querySelector('thead tr');
    thead.textContent = '';
    ['Status', 'Protocol', 'TVL', '7d', 'Market cap', 'Token'].forEach(function (h) { thead.appendChild(el('th', { scope: 'col', text: h })); });
    tbody.textContent = '';
    table.style.display = ''; empty.hidden = true;
    document.getElementById('count').textContent = DATA.live.length + ' live-token protocols';
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'pill live', text: 'already trades' }))
      ));
    });
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    var panel = document.getElementById('detail');
    panel.hidden = false;
    document.getElementById('detail-kicker').textContent = 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · ' + (row.watchlist ? 'on the watchlist' : 'early radar, below the watchlist floor');
    document.getElementById('detail-title').textContent = row.name;
    document.getElementById('detail-sub').textContent = (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · listed ' + (row.listed_at || 'date unknown');
    var v = impliedOf(row, DATA.model);
    var eq = document.getElementById('detail-equation');
    eq.textContent = '';
    var rows = [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Seven-day growth', fmtPct(row.change_7d)],
      ['Age with no token', fmtAge(row.age_days)],
      ['Chains', String((row.chains || []).length)],
      ['Base (power law)', fmtUsd(v.base)],
      ['Growth multiplier', v.growthMult.toFixed(4)],
      ['Maturity multiplier', v.maturityMult.toFixed(4)],
      ['Breadth multiplier', v.breadthMult.toFixed(4)],
      ['Implied value', fmtUsd(row.implied_value_usd)]
    ];
    rows.forEach(function (pair) {
      eq.appendChild(el('div', null, el('dt', { text: pair[0] }), el('dd', { text: pair[1] })));
    });
    document.getElementById('detail-check').textContent = 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(v.implied) +
      (v.implied === row.implied_value_usd ? ', the same number board.json carries.' : ' — which differs from the board, so the data would be stale.') +
      ' This is an estimate, not a price.';
    var steps = farmSteps(row);
    var ol = document.getElementById('detail-steps');
    ol.textContent = '';
    steps.forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      ol.appendChild(el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail })));
    });
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    renderRowsOnly();
  }

  function renderRowsOnly() {
    // Re-render the table without wiping the detail panel.
    if (state.tab === 'pre-token') boardTable(); else liveTable();
  }

  function wireControls() {
    var q = document.getElementById('q');
    q.value = state.q;
    q.addEventListener('input', function () { state.q = q.value; writeHash(); renderRowsOnly(); });
    var cat = document.getElementById('category');
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); renderRowsOnly(); });
    var ch = document.getElementById('chain');
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); renderRowsOnly(); });
    var mv = document.getElementById('mintvl');
    mv.value = String(state.mintvl);
    mv.addEventListener('change', function () { state.mintvl = parseInt(mv.value, 10) || 0; writeHash(); renderRowsOnly(); });
    var wo = document.getElementById('watchonly');
    wo.checked = state.watchonly;
    wo.addEventListener('change', function () { state.watchonly = wo.checked; writeHash(); renderRowsOnly(); });
    var pre = document.getElementById('tab-pre');
    var live = document.getElementById('tab-live');
    pre.addEventListener('click', function () { state.tab = 'pre-token'; pre.setAttribute('aria-pressed', 'true'); live.setAttribute('aria-pressed', 'false'); renderRowsOnly(); writeHash(); });
    live.addEventListener('click', function () { state.tab = 'live'; live.setAttribute('aria-pressed', 'true'); pre.setAttribute('aria-pressed', 'false'); renderRowsOnly(); writeHash(); });
    if (state.tab === 'live') { live.setAttribute('aria-pressed', 'true'); pre.setAttribute('aria-pressed', 'false'); }
    document.getElementById('clear-filters').addEventListener('click', function () {
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.mintvl = 0; state.watchonly = false;
      q.value = ''; cat.value = 'all'; ch.value = 'all'; mv.value = '0'; wo.checked = false;
      writeHash(); renderRowsOnly();
    });
    document.getElementById('detail-close').addEventListener('click', function () {
      state.selected = null;
      document.getElementById('detail').hidden = true;
      writeHash(); renderRowsOnly();
    });
  }

  function render() {
    renderRowsOnly();
    app.setAttribute('aria-busy', 'false');
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  fillStatic();
  wireControls();
  render();
})();
