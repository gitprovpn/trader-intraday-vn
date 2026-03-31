const DEFAULT_SYMBOLS = ["SSI", "FPT", "HPG", "VCI", "VND", "TCB", "MWG", "ACB"];
const el = (id) => document.getElementById(id);

const state = {
  running: true,
  feedMode: "DEMO",
  symbol: "SSI",
  quotes: {},
  ticks: [],
  curve: [],
  fills: [],
  orderBook: [],
  timer: null,
  marketTimer: null,
  startCash: 100_000_000,
  cash: 100_000_000,
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
  sentiment: 0,
  dcaSize: 5_000_000,
  takeProfitPct: 1.6,
  cutLossPct: 1.2,
  feePct: 0.15,
  taxPct: 0.10,
  sigma: 0,
};

function fmtMoney(v) {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return sign + Math.abs(v).toLocaleString("vi-VN", { maximumFractionDigits: 0 });
}
function fmtPrice(v) {
  return Number(v || 0).toLocaleString("vi-VN", { maximumFractionDigits: 2 });
}
function pct(v) {
  return `${(v || 0).toFixed(2)}%`;
}
function nowTime() {
  return new Date().toLocaleTimeString("en-GB");
}
function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
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
function pushTape(type, text, pnl = null) {
  state.fills.unshift({ time: nowTime(), type, text, pnl });
  state.fills = state.fills.slice(0, 120);
  renderTape();
}

function generateDepth(mid, prevClose = mid) {
  const spread = Math.max(10, Math.round(mid * 0.001 * (1 + Math.random() * 0.5)));
  state.orderBook = Array.from({ length: 8 }, (_, i) => {
    const step = (i + 1) * Math.max(10, Math.round(mid * 0.0006));
    return {
      bid: Math.max(0, mid - step),
      ask: mid + step,
      bidQty: Math.floor(rand(20, 320)) * 100,
      askQty: Math.floor(rand(20, 320)) * 100,
    };
  });
  el("postBid").textContent = fmtPrice(mid - spread / 2);
  el("postAsk").textContent = fmtPrice(mid + spread / 2);
  el("spreadText").textContent = fmtPrice(spread);
  renderOrderBook();

  const sigma = prevClose ? Math.abs((mid - prevClose) / prevClose) * 100 : 0;
  state.sigma = sigma;
  el("engineLine").textContent = `γ risk = ${(0.1 + Math.abs(state.sentiment) * 0.02).toFixed(2)} | σ live = ${sigma.toFixed(2)}%`;
}

function calcUnrealized() {
  const mark = currentMark();
  state.unrealized = state.qty > 0 ? (mark - state.avgPrice) * state.qty : 0;
}

function buy(reason = "BUY") {
  const mark = currentMark();
  if (!mark) return;
  const budget = state.dcaSize;
  const qty = Math.max(100, Math.floor(budget / mark / 100) * 100);
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
    if (pressure > 57 && Math.random() > 0.38) buy("OPEN T0");
  } else {
    if (movePct >= state.takeProfitPct) sellAll("TAKE PROFIT");
    else if (movePct <= -state.cutLossPct) sellAll("CUT LOSS");
    else if (movePct < -state.cutLossPct * 0.55 && Math.random() > 0.45) buy("AVERAGE DOWN");
    else if (movePct > state.takeProfitPct * 0.55 && Math.random() > 0.56) sellAll("SCALP EXIT");
  }

  if (Math.random() > 0.72) {
    const labels = ["FLOW", "QUOTE", "SIGNAL", "VWAP", "MEANREV", "RISK"];
    const label = labels[Math.floor(Math.random() * labels.length)];
    pushTape("INFO", `${label} ${state.symbol} pressure ${Math.round(pressure)} last ${fmtPrice(mark)}`);
  }

  state.curve.push({ t: Date.now(), pnl: sessionPnl() });
  state.curve = state.curve.slice(-80);
  renderCurve();
  render();
}

function applyConfig() {
  state.startCash = Number(el("inputCash").value || 0);
  state.dcaSize = Number(el("inputDcaSize").value || 0);
  state.takeProfitPct = Number(el("inputTakeProfit").value || 0);
  state.cutLossPct = Number(el("inputCutLoss").value || 0);
  state.feePct = Number(el("inputFee").value || 0);
  state.taxPct = Number(el("inputTax").value || 0);
  state.sentiment = Number(el("inputSentiment").value || 0);
  state.symbol = el("symbolSelect").value;
  renderWatchlist();
  generateDepth(currentMark(), state.quotes[state.symbol]?.prevClose || currentMark());
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
}

function toggleRunning() {
  state.running = !state.running;
  el("btnStartStop").textContent = state.running ? "Pause" : "Run";
  el("metricStatus").textContent = state.running ? "LIVE" : "PAUSED";
}

function renderWatchlist() {
  const root = el("watchlist");
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
      el("symbolSelect").value = q.symbol;
      renderWatchlist();
      generateDepth(q.last, q.prevClose || q.last);
      render();
    });
    root.appendChild(row);
  });
}

function renderOrderBook() {
  const root = el("orderBook");
  root.innerHTML = state.orderBook.map((row) => `
    <div class="book-row">
      <div class="book-cell bid">
        <div class="fill" style="width:${Math.min(100, row.bidQty / 4_000)}%"></div>
        <div class="content"><span class="price">BID ${fmtPrice(row.bid)}</span><span>${row.bidQty.toLocaleString("vi-VN")}</span></div>
      </div>
      <div class="book-cell ask">
        <div class="fill" style="width:${Math.min(100, row.askQty / 4_000)}%"></div>
        <div class="content"><span>${row.askQty.toLocaleString("vi-VN")}</span><span class="price">ASK ${fmtPrice(row.ask)}</span></div>
      </div>
    </div>
  `).join("");
}

function renderTape() {
  const root = el("tape");
  root.innerHTML = state.fills.map((item) => `
    <div class="tape-row">
      <span class="time">${item.time}</span>
      <span class="type-${item.type === "BUY" ? "buy" : item.type === "SELL" ? "sell" : item.type === "RISK" ? "risk" : "info"}">${item.type}</span>
      <span>${item.text}</span>
      <span class="${item.pnl == null ? "" : item.pnl >= 0 ? "pos" : "neg"}">${item.pnl == null ? "--" : fmtMoney(item.pnl)}</span>
    </div>
  `).join("");
}

function renderCurve() {
  const svg = el("curveSvg");
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
  el("metricSessionPnl").textContent = fmtMoney(sessionPnl());
  el("metricSessionPnl").className = sessionPnl() >= 0 ? "pos" : "neg";
  el("metricRealized").textContent = fmtMoney(state.realized);
  el("metricUnrealized").textContent = fmtMoney(state.unrealized);
  el("metricWinRate").textContent = pct(winRate());
  el("metricFills").textContent = state.fillsCount.toLocaleString("vi-VN");
  el("metricActive").textContent = state.symbol;
  el("metricFeedMode").textContent = state.feedMode;

  el("posCash").textContent = fmtMoney(state.cash);
  el("posQty").textContent = state.qty.toLocaleString("vi-VN");
  el("posAvg").textContent = state.avgPrice ? fmtPrice(state.avgPrice) : "--";
  el("posMark").textContent = fmtPrice(mark);
  el("posFees").textContent = fmtMoney(state.fees);
  el("posTax").textContent = fmtMoney(state.tax);
  el("posEquity").textContent = fmtMoney(equity());
  el("posSpreadCapture").textContent = fmtMoney(state.spreadCapture);
}

function normalizeIntradayPayload(payload) {
  const rows = Array.isArray(payload?.intraday) ? payload.intraday : [];
  const quote = payload?.quote || {};
  if (!rows.length && quote.last) {
    return [{ close: quote.last, time: nowTime(), volume: quote.volume || 0 }];
  }
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
  const pressure = clamp(50 + (change / Math.max(1, prevClose)) * 3000 + state.sentiment * 8, 1, 99);
  return {
    symbol,
    last,
    prevClose,
    volume: Number(quote?.volume || rows.at(-1)?.volume || 0),
    change,
    changePct: prevClose ? (change / prevClose) * 100 : 0,
    pressure,
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
  const rows = Array.from({ length: 40 }, (_, i) => {
    px = Math.max(1_000, px + Math.round(rand(-120, 120)));
    return {
      close: px,
      open: px - Math.round(rand(-60, 60)),
      high: px + Math.round(rand(0, 120)),
      low: px - Math.round(rand(0, 120)),
      volume: Math.floor(rand(1000, 50000)),
      time: `09:${String(10 + i).padStart(2, "0")}:00`,
    };
  });
  return { intraday: rows, quote: { symbol, last: rows.at(-1).close, prevClose: base, volume: rows.at(-1).volume }, source: "DEMO" };
}

async function refreshMarket() {
  const symbols = DEFAULT_SYMBOLS;
  const results = await Promise.allSettled(symbols.map(async (symbol) => {
    try {
      return await fetchSymbol(symbol);
    } catch {
      return demoBootstrap(symbol);
    }
  }));

  results.forEach((res, idx) => {
    const symbol = symbols[idx];
    const payload = res.status === "fulfilled" ? res.value : demoBootstrap(symbol);
    const rows = normalizeIntradayPayload(payload);
    const q = buildQuoteFromSeries(symbol, rows, payload.quote);
    state.quotes[symbol] = q;
    if (symbol === state.symbol) {
      generateDepth(q.last, q.prevClose);
    }
  });

  const anyLive = results.some((r) => r.status === "fulfilled" && r.value?.source === "SSI_FASTCONNECT");
  state.feedMode = anyLive ? "SSI LIVE" : "DEMO FALLBACK";
  renderWatchlist();
  render();
}

function startLoops() {
  clearInterval(state.timer);
  clearInterval(state.marketTimer);
  state.marketTimer = setInterval(async () => {
    if (!state.running) return;
    await refreshMarket();
  }, 15_000);
  state.timer = setInterval(() => {
    if (!state.running) return;

    for (const symbol of Object.keys(state.quotes)) {
      const q = state.quotes[symbol];
      const drift = state.sentiment * q.last * 0.00035;
      const jitter = rand(-1, 1) * Math.max(8, q.last * 0.0014);
      const next = Math.max(1000, q.last + drift + jitter);
      q.last = Math.round(next);
      q.change = q.last - q.prevClose;
      q.changePct = q.prevClose ? (q.change / q.prevClose) * 100 : 0;
      q.pressure = clamp(50 + q.changePct * 12 + rand(-8, 8), 1, 99);
      q.volume += Math.floor(rand(100, 3000));
      q.ticks.push({ close: q.last, open: q.last, high: q.last, low: q.last, volume: q.volume, time: nowTime() });
      q.ticks = q.ticks.slice(-60);
    }

    const active = state.quotes[state.symbol];
    if (active) generateDepth(active.last, active.prevClose);
    renderWatchlist();
    autoTradeStep();
  }, 1200);
}

function bootstrap() {
  const symbolSelect = el("symbolSelect");
  symbolSelect.innerHTML = DEFAULT_SYMBOLS.map((s) => `<option value="${s}">${s}</option>`).join("");
  symbolSelect.value = state.symbol;

  el("btnApply").addEventListener("click", applyConfig);
  el("btnReset").addEventListener("click", resetPortfolio);
  el("btnStartStop").addEventListener("click", toggleRunning);
  el("btnBuy").addEventListener("click", () => buy("MANUAL BUY"));
  el("btnSell").addEventListener("click", () => sellAll("MANUAL SELL"));
  symbolSelect.addEventListener("change", applyConfig);

  resetPortfolio();
  refreshMarket().then(() => {
    renderWatchlist();
    renderOrderBook();
    renderCurve();
    render();
    startLoops();
  });
}

bootstrap();
