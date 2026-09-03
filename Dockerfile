# ---------------------------------------------------------------------------
# VLSE — تصویر تولیدی برای استقرار روی سرور داخلی شرکت
#
# دو مرحله دارد: مرحلهٔ بیلد کل سورس و وابستگی‌های توسعه را می‌گیرد، و مرحلهٔ
# اجرا فقط خروجی بیلد و وابستگی‌های تولیدی را برمی‌دارد. پیش‌تر کل پوشهٔ
# node_modules مرحلهٔ بیلد کپی می‌شد، یعنی Vite و ESLint و کل زنجیرهٔ ابزار
# توسعه هم روی سرور تولید می‌نشست.
#
# نصب با `npm ci` انجام می‌شود نه `npm install`: بدون فایل قفل، هر بیلد ممکن
# بود نسخهٔ متفاوتی از وابستگی‌ها بیاورد و چیزی که روی سرور اجرا می‌شد دقیقاً
# همان چیزی نبود که آزموده شده است.
# ---------------------------------------------------------------------------

FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# فقط وابستگی‌های تولیدی. `prisma` عمداً جزو dependencies است، چون مهاجرت‌ها
# هنگام بالا آمدن کانتینر اجرا می‌شوند و CLI آن باید در همین تصویر باشد.
COPY package.json package-lock.json ./
# schema پیش از نصب کپی می‌شود چون postinstall همین‌جا `prisma generate` را
# صدا می‌زند و بدون schema شکست می‌خورد.
COPY prisma ./prisma/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/database ./database
COPY scripts/docker-entrypoint.sh ./scripts/docker-entrypoint.sh
RUN chmod +x ./scripts/docker-entrypoint.sh

EXPOSE 3000

# سلامت واقعی سرویس یعنی «پایگاه‌داده پاسخ می‌دهد»، نه «پروسه بالاست»:
# /api/health خودش یک کوئری می‌زند و در صورت قطعی ۵۰۳ می‌دهد.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
