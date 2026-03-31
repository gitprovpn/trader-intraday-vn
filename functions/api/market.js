const BASE = 'https://fc-data.ssi.com.vn/api/v2/Market';
let tokenCache = { token: null, expiresAt: 0 };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function getToken(env) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now) return tokenCache.token;

  const consumerID = env.SSI_CONSUMER_ID;
  const consumerSecret = env.SSI_CONSUMER_SECRET;
  if (!consumerID || !consumerSecret) return null;

  const resp = await fetch(`${BASE}/AccessToken`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ consumerID, consumerSecret }),
  });
  if (!resp.ok) throw new Error(`AccessToken ${resp.status}`);
  const data = await resp.json();
  const token = data?.data?.accessToken || data?.accessToken || null;
  if (!token) throw new Error('No accessToken returned');

  tokenCache = { token, expiresAt: now + 15 * 60 * 1000 };
  return token;
}

async function fetchSsi(path, params, token) {
  const url = new URL(`${BASE}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });

  const authScheme = 'Bearer';
  const resp = await fetch(url.toString(), {
    headers: token ? { Authorization: `${authScheme} ${token}` } : {},
  });
  if (!resp.ok) throw new Error(`${path} ${resp.status}`);
  return await resp.json();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || 'SSI').toUpperCase();
  const market = (searchParams.get('market') || 'HOSE').toUpperCase();
  const today = new Date();
  const fromdate = searchParams.get('fromdate') || formatDate(today);
  const todate = searchParams.get('todate') || formatDate(today);

  try {
    const token = await getToken(env);
    if (!token) {
      return json({
        source: 'DEMO',
        note: 'SSI_CONSUMER_ID / SSI_CONSUMER_SECRET not configured',
        intraday: [],
        quote: null,
      });
    }

    const [intradayRes, dailyRes] = await Promise.all([
      fetchSsi('IntradayOhlc', { pageIndex: '1', pageSize: '1000', Symbol: symbol, Fromdate: fromdate, Todate: todate }, token),
      fetchSsi('DailyStockPrice', { pageIndex: '1', pageSize: '1', symbol, market, Fromdate: fromdate, Todate: todate }, token),
    ]);

    const intraday = Array.isArray(intradayRes?.data) ? intradayRes.data : [];
    const daily = Array.isArray(dailyRes?.data) ? dailyRes.data[0] : null;

    const last = Number(daily?.ClosePrice || intraday.at(-1)?.Close || intraday.at(-1)?.Value || 0);
    const prevClose = Number(daily?.RefPrice || daily?.ClosePrice || last || 0);
    const volume = Number(daily?.TotalTradedVol || intraday.at(-1)?.Volume || 0);

    return json({
      source: 'SSI_FASTCONNECT',
      symbol,
      market,
      intraday,
      quote: {
        symbol,
        last,
        prevClose,
        volume,
        reference: prevClose,
      },
    });
  } catch (error) {
    return json({ source: 'DEMO', error: error.message, intraday: [], quote: null }, 200);
  }
}
