# PaperTrade VN Bot v2

Cloudflare Pages one-page mô phỏng **intraday paper trading** cho thị trường Việt Nam.

## Điểm mới của v2
- Bot **tự động mua / bán / DCA / chốt lời / cắt lỗ**
- UI public chỉ hiển thị:
  - watchlist
  - order book giả lập
  - fill tape
  - PnL curve
  - inventory
- Không hiển thị form cấu hình thủ công trên giao diện
- Hỗ trợ Cloudflare Pages Functions qua `/api/market`
- Nếu chưa có API credential thì tự fallback sang `DEMO`

## Cấu trúc

```text
.
├─ index.html
├─ style.css
├─ app.js
├─ _headers
└─ functions/
   └─ api/
      └─ market.js
```

## Deploy trên Cloudflare Pages

- Framework preset: `None`
- Build command: để trống
- Build output directory: `.`
- Root directory: để trống

## Environment variables

Nếu muốn thử lấy dữ liệu thật qua SSI FastConnect:

- `SSI_CONSUMER_ID`
- `SSI_CONSUMER_SECRET`

## Lưu ý

- Đây là **paper trading simulator**, không gửi lệnh broker thật.
- PnL là mô phỏng theo dữ liệu giá và engine chiến lược nội bộ.
- Không đảm bảo thắng, chỉ mô phỏng bot trade như một trader intraday.
