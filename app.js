const BOT_CONFIG = {
  startCash: 100_000_000,
  dcaSize: 5_000_000,
  takeProfitPct: 1.6,
  cutLossPct: 1.2,
  feePct: 0.15,
  taxPct: 0.10,
  baseSentiment: 0,
  symbols: ["SSI", "HPG", "FPT", "TCB", "MWG", "VND"],
};

const state = {
  running: true,
  symbol: BOT_CONFIG.symbols[0],
  quotes: {},
  orderBook: [],
  fills: [],
  curve: [],
  startCash: BOT_CONFIG.startCash,
  cash: BOT_CONFIG.startCash,
  dcaSize: BOT_CONFIG.dcaSize,
  takeProfitPct: BOT_CONFIG.takeProfitPct,
  cutLossPct: BOT_CONFIG.cutLossPct,
  feePct: BOT_CONFIG.feePct,
  taxPct: BOT_CONFIG.taxPct,
  sentiment: BOT_CONFIG.baseSentiment,
  qty: 0,
  avgPrice: 0,
  realized: 0,
  unrealized: 0,
  fees: 0,
  tax: 0,
  spreadCapture: 0,
  fillsCount: 0,
  winCount: 0,
  closeCount: 0,
  feedMode: "BOOTING",
  sourceName: "Loading",
  timers: [],
};

const $ = (id) => document.getElementById(id);
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const rand = (min, max) => Math.random() * (max - min) + min;
const nowTime = () => new Date().toLocaleTimeString("en-GB");
const fmtPrice = (v) => Number(v || 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
const fmtMoney = (v) => `${v >= 0 ? "+" : "-"}${Math.abs(v || 0).toLocaleString("vi-VN", { maximumFractionDigits: 0 })}`;
const pct = (v) => `${v >= 0 ? "+" : ""}${Number(v || 0).toFixed(2)}%`;

function sessionPnl() {
  return state.realized + state.unrealized;
}
function equity() {
  return state.cash + state.qty * currentMark();
}
function winRate() {
  return state.closeCount ? (state.winCount / state.closeCount) * 100 : 0;
}
function currentMark() {
  return state.quotes[state.symbol]?.last || 0;
}

function setMetricTone(node, value) {
  node.classList.remove("pos", "neg");
  node.classList.add(value >= 0 ? "pos" : "neg");
}

function pushTape(type, text, pnl = null) {
  state.fills.unshift({ time: nowTime(), type, text, pnl });
  state.fills = state.fills.slice(0, 90);
  renderTape();
}

function calcUnrealized() {
  const mark = currentMark();
  state.unrealized = state.qty > 0 ? (mark - state.avgPrice) * state.qty : 0;
}

function updateBotHeader() {
  $("botCapital").textContent = fmtMoney(state.startCash);
  $("botDcaUnit").textContent = fmtMoney(state.dcaSize);
  $("botTp").textContent = `${state.takeProfitPct.toFixed(2)}%`;
  $("botCl").textContent = `${state.cutLossPct.toFixed(2)}%`;
  $("botBias").textContent = state.sentiment > 0 ? "Bullish" : state.sentiment < 0 ? "Bearish" : "Neutral";
  $("botDataSource").textContent = state.sourceName;
  $("botExecution").textContent = state.running ? "Auto Buy / Sell" : "Paused";
  $("flowBias").textContent = state.sentiment > 0 ? "BULL FLOW" : state.sentiment < 0 ? "BEAR FLOW" : "NEUTRAL";
}

function generateDepth(mid, ref) {
  if (!mid) return;
  const tick = mid < 10000 ? 10 : mid < 50000 ? 50 : 100;
  state.orderBook = Array.from({ length: 8 }).map((_, i) => {
    const bid = Math.max(1, mid - tick * (i + 1));
    const ask = mid + tick * (i + 1);
    const drift = ((mid - ref) / Math.max(1, ref)) * 100;
    const bidQty = Math.floor(rand(200, 4000) * (drift <= 0 ? 1.1 : 0.9));
    const askQty = Math.floor(rand(200, 4000) * (drift >= 0 ? 1.1 : 0.9));
    return { bid, ask, bidQty, askQty };
  });
  $("postBid").textContent = fmtPrice(mid - tick);
  $("postAsk").textContent = fmtPrice(mid + tick);
  $("spreadText").textContent = fmtPrice(tick * 2);
  renderOrderBook();
}

function buy(reason = "BUY") {
  const mark = currentMark();
  if (!mark) return;
  const budget = state.dcaSize;
  const lotQty = mark > 0 ? Math.floor(budget / mark / 100) * 100 : 0;
  const qty = Math.max(100, lotQty);
  const cost = qty * mark;
  const fee = cost * (state.feePct / 100);
  if (state.cash < cost + fee) {
    pushTape("RISK", `Insufficient cash for ${reason}`);
    return;
  }
  const newQty = state.qty + qty;
  state.avgPrice = newQty > 0 ? ((state.avgPrice * state.qty) + cost) / newQty : 0;
  state.qty = newQty;
  state.cash -= cost + fee;
  state.fees += fee;
  state.fillsCount += 1;
  pushTape("BUY", `${reason} ${state.symbol} qty ${qty} @ ${fmtPrice(mark)}`);
  calcUnrealized();
  render();
}

function sellAll(reason = "SELL") {
  const mark = currentMark();
  if (!mark || state.qty <= 0) return;
  const gross = state.qty * mark;
  const fee = gross * (state.feePct / 100);
  const tax = gross * (state.taxPct / 100);
  const pnl = (mark - state.avgPrice) * state.qty - fee - tax;
  state.cash += gross - fee - tax;
  state.realized += pnl;
  state.fees += fee;
  state.tax += tax;
  state.spreadCapture += Math.max(0, (mark - state.avgPrice) * state.qty * 0.2);
  state.fillsCount += 1;
  state.closeCount += 1;
  if (pnl > 0) state.winCount += 1;
  pushTape(pnl >= 0 ? "SELL" : "RISK", `${reason} ${state.symbol} qty ${state.qty} @ ${fmtPrice(mark)}`, pnl);
  state.qty = 0;
  state.avgPrice = 0;
  state.unrealized = 0;
  render();
}

function autoTradeStep() {
  const q = state.quotes[state.symbol];
  if (!q) return;
  calcUnrealized();
  const mark = q.last;
  const movePct = state.avgPrice ? ((mark - state.avgPrice) / state.avgPrice) * 100 : 0;
  const pressure = q.pressure ?? 50;

  if (state.qty === 0) {
    if (pressure > 57 && Math.random() > 0.36) buy("OPEN T0");
  } else {
    if (movePct >= state.takeProfitPct) sellAll("TAKE PROFIT");
    else if (movePct <= -state.cutLossPct) sellAll("CUT LOSS");
    else if (movePct < -state.cutLossPct * 0.55 && state.cash > state.dcaSize && Math.random() > 0.42) buy("AVERAGE DOWN");
    else if (movePct > state.takeProfitPct * 0.5 && Math.random() > 0.55) sellAll("SCALP EXIT");
    else if (Math.abs(movePct) < 0.12 && Math.random() > 0.92) sellAll("TIME EXIT");
  }

  if (Math.random() > 0.72) {
    const labels = ["FLOW", "QUOTE", "SIGNAL", "VWAP", "MEANREV", "RISK"];
    const label = labels[Math.floor(Math.random() * labels.length)];
    pushTape("INFO", `${label} ${state.symbol} pressure ${Math.round(pressure)} last ${fmtPrice(mark)}`);
  }

  state.curve.push({ t: Date.now(), pnl: sessionPnl() });
  state.curve = state.curve.slice(-90);
  renderCurve();
  render();
}

function resetPortfolio() {
  state.cash = state.startCash;
  state.qty = 0;
  state.avgPrice = 0;
  state.realized = 0;
  state.unrealized = 0;
  state.fees = 0;
  state.tax = 0;
  state.spreadCapture = 0;
  state.fillsCount = 0;
  state.winCount = 0;
  state.closeCount = 0;
  state.curve = [];
  state.fills = [];
  pushTape("INFO", `Portfolio reset with cash ${fmtMoney(state.cash)}`);
  render();
  renderCurve();
}

function toggleRunning() {
  state.running = !state.running;
  $("btnStartStop").textContent = state.running ? "Pause Bot" : "Run Bot";
  $("metricStatus").textContent = state.running ? "LIVE" : "PAUSED";
  updateBotHeader();
}

function renderWatchlist() {
  const root = $("watchlist");
  root.innerHTML = "";
  Object.values(state.quotes).forEach((q) => {
    const row = document.createElement("button");
    row.className = `watch-item ${q.symbol === state.symbol ? "active" : ""}`;
    row.innerHTML = `
      <div class="watch-head">
        <span class="watch-symbol">${q.symbol}</span>
        <span class="watch-price ${q.change >= 0 ? "pos" : "neg"}">${fmtPrice(q.last)}</span>
      </div>
      <div class="watch-head">
        <span class="pnl ${q.change >= 0 ? "pos" : "neg"}">${fmtPrice(q.change)}</span>
        <span>${pct(q.changePct)}</span>
      </div>
      <div class="pressbar"><i style="width:${q.pressure}%"></i></div>
    `;
    row.addEventListener("click", () => {
      state.symbol = q.symbol;
      renderWatchlist();
      generateDepth(q.last, q.prevClose || q.last);
      render();
    });
    root.appendChild(row);
  });
}

function renderOrderBook() {
  const root = $("orderBook");
  root.innerHTML = state.orderBook.map((row) => `
    <div class="book-row">
      <div class="book-cell bid">
        <div class="fill" style="width:${Math.min(100, row.bidQty / 40)}%"></div>
        <div class="content"><span class="price">BID ${fmtPrice(row.bid)}</span><span>${row.bidQty.toLocaleString("vi-VN")}</span></div>
      </div>
      <div class="book-cell ask">
        <div class="fill" style="width:${Math.min(100, row.askQty / 40)}%"></div>
        <div class="content"><span>${row.askQty.toLocaleString("vi-VN")}</span><span class="price">ASK ${fmtPrice(row.ask)}</span></div>
      </div>
    </div>
  `).join("");
}

function renderTape() {
  $("tape").innerHTML = state.fills.map((item) => `
    <div class="tape-row">
      <span class="time">${item.time}</span>
      <span class="type-${item.type === "BUY" ? "buy" : item.type === "SELL" ? "sell" : item.type === "RISK" ? "risk" : "info"}">${item.type}</span>
      <span>${item.text}</span>
      <span class="${item.pnl == null ? "" : item.pnl >= 0 ? "pos" : "neg"}">${item.pnl == null ? "--" : fmtMoney(item.pnl)}</span>
    </div>
  `).join("");
}

function renderCurve() {
  const svg = $("curveSvg");
  const w = 420, h = 300, pad = 14;
  const data = state.curve.length ? state.curve : [{ pnl: 0 }, { pnl: 0 }];
  const pnls = data.map((d) => d.pnl);
  let min = Math.min(...pnls), max = Math.max(...pnls);
  if (min === max) { min -= 1; max += 1; }
  const points = data.map((d, i) => {
    const x = pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((d.pnl - min) / (max - min)) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  const baseY = h - pad - ((0 - min) / (max - min)) * (h - pad * 2);
  const stroke = sessionPnl() >= 0 ? "#35ff64" : "#ff5168";
  svg.innerHTML = `
    <line x1="0" y1="${baseY}" x2="${w}" y2="${baseY}" stroke="rgba(255,255,255,.12)" stroke-dasharray="4 4" />
    <polyline fill="none" stroke="${stroke}" stroke-width="3" points="${points}" />
  `;
}

function render() {
  const mark = currentMark();
  calcUnrealized();
  const pnl = sessionPnl();
  $("metricSessionPnl").textContent = fmtMoney(pnl);
  setMetricTone($("metricSessionPnl"), pnl);
  $("metricRealized").textContent = fmtMoney(state.realized);
  setMetricTone($("metricRealized"), state.realized);
  $("metricUnrealized").textContent = fmtMoney(state.unrealized);
  setMetricTone($("metricUnrealized"), state.unrealized);
  $("metricWinRate").textContent = pct(winRate());
  $("metricFills").textContent = state.fillsCount.toLocaleString("vi-VN");
  $("metricActive").textContent = state.symbol;
  $("metricFeedMode").textContent = state.feedMode;

  $("posCash").textContent = fmtMoney(state.cash);
  $("posQty").textContent = state.qty.toLocaleString("vi-VN");
  $("posAvg").textContent = state.avgPrice ? fmtPrice(state.avgPrice) : "--";
  $("posMark").textContent = fmtPrice(mark);
  $("posFees").textContent = fmtMoney(state.fees);
  $("posTax").textContent = fmtMoney(state.tax);
  $("posEquity").textContent = fmtMoney(equity());
  $("posSpreadCapture").textContent = fmtMoney(state.spreadCapture);
  $("engineLine").textContent = `γ risk = ${(0.08 + Math.abs(state.sentiment) * 0.03).toFixed(2)} | σ live = ${((state.quotes[state.symbol]?.volatility || 0) * 100).toFixed(2)}%`;
  $("marketPulse").textContent = `${state.symbol} ${pct(state.quotes[state.symbol]?.changePct || 0)}`;
  $("clockText").textContent = nowTime();
  updateBotHeader();
}

function normalizeIntradayPayload(payload) {
  const rows = Array.isArray(payload?.intraday) ? payload.intraday : [];
  const quote = payload?.quote || {};
  if (!rows.length && quote.last) return [{ close: quote.last, open: quote.prevClose || quote.last, volume: quote.volume || 0, time: nowTime() }];
  return rows.map((r) => ({
    close: Number(r.Close ?? r.close ?? r.Value ?? 0),
    open: Number(r.Open ?? r.open ?? r.Value ?? 0),
    high: Number(r.High ?? r.high ?? r.Value ?? 0),
    low: Number(r.Low ?? r.low ?? r.Value ?? 0),
    volume: Number(r.Volume ?? r.volume ?? 0),
    time: r.Time ?? r.time ?? nowTime(),
  })).filter((r) => r.close > 0);
}

function buildQuoteFromSeries(symbol, rows, quote) {
  const last = Number(quote?.last || rows.at(-1)?.close || 0);
  const prevClose = Number(quote?.prevClose || quote?.reference || rows[0]?.open || last);
  const change = last - prevClose;
  const volatility = rows.length > 1 ? Math.abs((rows.at(-1).close - rows[0].close) / Math.max(1, rows[0].close)) : 0;
  const pressure = clamp(50 + (change / Math.max(1, prevClose)) * 3000 + state.sentiment * 8, 1, 99);
  return {
    symbol,
    last,
    prevClose,
    volume: Number(quote?.volume || rows.at(-1)?.volume || 0),
    change,
    changePct: prevClose ? (change / prevClose) * 100 : 0,
    pressure,
    volatility,
    ticks: rows,
  };
}

async function fetchSymbol(symbol) {
  const resp = await fetch(`/api/market?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  return await resp.json();
}

function demoBootstrap(symbol) {
  const base = 20_000 + Math.round(rand(0, 15_000));
  let px = base;
  const rows = Array.from({ length: 45 }, (_, i) => {
    px = Math.max(1_000, px + Math.round(rand(-120, 120)));
    return {
      close: px,
      open: px - Math.round(rand(-60, 60)),
      high: px + Math.round(rand(0, 120)),
      low: px - Math.round(rand(0, 120)),
      volume: Math.floor(rand(1_000, 50_000)),
      time: `09:${String(10 + i).padStart(2, "0")}:00`,
    };
  });
  return {
    source: "DEMO",
    quote: { symbol, last: rows.at(-1).close, prevClose: rows[0].open, volume: rows.at(-1).volume },
    intraday: rows,
  };
}

function evolveDemoQuote(q) {
  const noise = rand(-0.003, 0.003);
  const drift = q.changePct > 0 ? rand(-0.0015, 0.0025) : rand(-0.0025, 0.0015);
  const sentiment = state.sentiment * 0.0012;
  const next = Math.max(1000, Math.round(q.last * (1 + noise + drift + sentiment)));
  const change = next - q.prevClose;
  const changePct = q.prevClose ? (change / q.prevClose) * 100 : 0;
  const pressure = clamp(50 + changePct * 18 + state.sentiment * 10, 1, 99);
  return { ...q, last: next, change, changePct, pressure, volume: Math.max(0, q.volume + Math.floor(rand(100, 2500))) };
}

async function bootstrapMarket() {
  let liveLoaded = false;
  for (const symbol of BOT_CONFIG.symbols) {
    try {
      const payload = await fetchSymbol(symbol);
      const rows = normalizeIntradayPayload(payload);
      if (payload?.source && payload.source !== "DEMO") liveLoaded = true;
      const q = buildQuoteFromSeries(symbol, rows.length ? rows : normalizeIntradayPayload(demoBootstrap(symbol)), payload.quote || {});
      state.quotes[symbol] = q;
    } catch {
      const payload = demoBootstrap(symbol);
      const rows = normalizeIntradayPayload(payload);
      state.quotes[symbol] = buildQuoteFromSeries(symbol, rows, payload.quote);
    }
  }
  state.feedMode = liveLoaded ? "LIVE" : "DEMO";
  state.sourceName = liveLoaded ? "SSI / Market API" : "Built-in demo";
  generateDepth(currentMark(), state.quotes[state.symbol]?.prevClose || currentMark());
  renderWatchlist();
  renderCurve();
  render();
  pushTape("INFO", `${state.feedMode} feed online · ${state.sourceName}`);
}

function tickMarket() {
  const wave = Math.sin(Date.now() / 4500);
  const drift = wave > 0.3 ? 1 : wave < -0.3 ? -1 : 0;
  if (Math.random() > 0.82) state.sentiment = drift;

  if (state.feedMode === "DEMO") {
    Object.keys(state.quotes).forEach((symbol) => {
      state.quotes[symbol] = evolveDemoQuote(state.quotes[symbol]);
    });
  } else {
    Object.keys(state.quotes).forEach((symbol) => {
      const q = state.quotes[symbol];
      state.quotes[symbol] = evolveDemoQuote(q);
    });
  }

  const active = state.quotes[state.symbol];
  generateDepth(active.last, active.prevClose || active.last);
  renderWatchlist();
  render();
}

function bindEvents() {
  $("btnStartStop").addEventListener("click", toggleRunning);
  $("btnReset").addEventListener("click", resetPortfolio);
}

async function bootstrap() {
  bindEvents();
  await bootstrapMarket();
  state.timers.push(setInterval(() => {
    tickMarket();
    if (state.running) autoTradeStep();
  }, 900));
  state.timers.push(setInterval(render, 1000));
}

bootstrap();
