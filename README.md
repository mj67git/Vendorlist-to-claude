# VLSE — سامانهٔ ارزیابی و رتبه‌بندی کیفی تأمین‌کنندگان

سامانهٔ ثبت، ارزیابی و رتبه‌بندی تأمین‌کنندگان مواد اولیهٔ دارویی (GxP/GMP). رابط کاربری فارسی و راست‌به‌چپ، داده روی PostgreSQL، سابقهٔ ممیزی فقط‌افزودنی.

## از کجا شروع کنم؟

| اگر شما … هستید | این را بخوانید |
| :--- | :--- |
| واحد **IT** و می‌خواهید سامانه را روی سرور بالا بیاورید | **[`deploy/README-IT.md`](deploy/README-IT.md)** — نصب با یک دستور، پشتیبان‌گیری، کارهای لازم |
| واحد IT و می‌خواهید از مسیر پیش‌فرض خارج شوید | [`IT_DEPLOYMENT_GUIDE.md`](IT_DEPLOYMENT_GUIDE.md) — متغیرهای محیطی، مهاجرت‌ها، ماتریس دسترسی، عیب‌یابی |
| **توسعه‌دهنده** | [`CLAUDE.md`](CLAUDE.md) (قواعد معماری) و [`STATUS.md`](STATUS.md) (وضعیت کارها) |

## نصب سریع روی سرور

```bash
./deploy/install.sh
```

پیش‌نیازها را می‌سنجد، `.env` را با رمز و کلید تصادفی می‌سازد، تصویر را build می‌کند، سرویس‌ها را بالا می‌آورد و آدرس ورود را چاپ می‌کند. جزئیات در `deploy/README-IT.md`.

## استک

React 19 + Vite 6 + TypeScript · Tailwind CSS 4 · Express 5 · Prisma 5 · PostgreSQL 15 · Docker Compose

## توسعه

```bash
bun install
npm run lint          # tsc --noEmit
npm test              # بدون DATABASE_URL، تست‌های API خودشان skip می‌شوند
npm run build
```

سوییت **۴۴۵** تست دارد: ۲۹۴ تست واحد و ۱۵۱ تست API که برنامهٔ واقعی را روی یک PostgreSQL موقت بالا می‌آورند و گاردهای دسترسی و مسیرهای نوشتن را از راه HTTP می‌سنجند.

## ساخت بستهٔ تحویلی

```bash
./scripts/make-release.sh 1.0.0     # → dist-release/VLSE-1.0.0.zip
```
