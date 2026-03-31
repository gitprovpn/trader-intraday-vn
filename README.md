# PaperTrade VN — Cloudflare Pages one-page

Mô phỏng intraday paper trading cho chứng khoán Việt Nam với giao diện terminal-style, lấy dữ liệu qua Cloudflare Pages Functions.

## Tính năng
- One-page frontend: `index.html + app.js + style.css`
- Pages Function proxy: `functions/api/market.js`
- Paper trading engine:
  - manual buy / sell
  - auto intraday scalp
  - DCA / average down
  - realized / unrealized PnL
  - phí giao dịch + thuế bán
  - watchlist / tape / order book / PnL curve
- Fallback demo mode nếu chưa cấu hình SSI API

## Cấu trúc
- `index.html`
- `style.css`
- `app.js`
- `functions/api/market.js`
- `_headers`

## Deploy lên Cloudflare Pages
1. Tạo repo GitHub mới và upload toàn bộ file.
2. Vào Cloudflare Dashboard → Workers & Pages → Create application → Pages.
3. Connect Git → chọn repo.
4. Build settings:
   - Framework preset: `None`
   - Build command: để trống
   - Build output directory: `/`
5. Deploy.

## Environment variables trên Cloudflare Pages
Nếu muốn dùng dữ liệu SSI FastConnect:
- `SSI_CONSUMER_ID`
- `SSI_CONSUMER_SECRET`

Thêm tại:
Pages project → Settings → Variables and Secrets → Add variable.

## Lưu ý về API
File `functions/api/market.js` đang dùng endpoint FastConnect Data của SSI:
- `POST /Market/AccessToken`
- `GET /Market/IntradayOhlc`
- `GET /Market/DailyStockPrice`

Nếu SSI thay đổi kiểu xác thực/header, hãy chỉnh ở hàm `fetchSsi()`.

## Chạy local
Có thể dùng Wrangler:
```bash
npm install -g wrangler
wrangler pages dev .
```

## Ghi chú nghiệp vụ
Đây là **paper trading intraday simulator** bám dữ liệu thị trường, không phải hệ thống đặt lệnh thật.
