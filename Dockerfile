# ----------------------------------------------------
# 🏗️ Dockerfile ویژه استقرار روی سرورهای داخلی شرکت
# ----------------------------------------------------

# مرحله ۱: بیلد (Build Stage)
FROM node:20-alpine AS builder

WORKDIR /app

# کپی فایل‌های مدیریت پکیج و ساختار دیتابیس
COPY package*.json ./
COPY prisma ./prisma/

# نصب تمام وابستگی‌ها
RUN npm install

# کپی کل سورس کد پروژه
COPY . .

# ساخت کلاینت پریزما و کامپایل نهایی فرانت‌اند و بک‌اند
RUN npx prisma generate
RUN npm run build

# مرحله ۲: اجرای نهایی (Production Runner Stage)
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# کپی فایل‌های کامپایل شده و مورد نیاز از مرحله بیلد
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/database ./database

EXPOSE 3000

# اجرای وب‌سرور نهایی
CMD ["node", "dist/server.cjs"]
