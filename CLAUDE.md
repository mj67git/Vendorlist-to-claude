# CLAUDE.md — راهنمای پروژه برای سشن‌های آینده

> این فایل، حافظهٔ پروژه برای Claude است. قبل از هر کاری این را بخوان.
> فایل هم‌تیمی: **`STATUS.md`** — وضعیت زندهٔ کارها و نقشهٔ راه.

## پروژه چیست
**VLSE** (Vendor List & Supplier Evaluation System) — سامانهٔ ارزیابی و رتبه‌بندی کیفی تأمین‌کنندگان دارویی (GxP/GMP). رابط کاربری **فارسی و RTL**.

## استک فنی
- **Frontend:** React 19 + Vite 6 + TypeScript، Tailwind CSS 4، shadcn/ui (Radix)، lucide-react، recharts، motion، فونت Vazirmatn.
- **Backend:** Express 5 در `server.ts` (مونولیت، ~۲۹۰۰ خط)، Prisma 5 → **PostgreSQL**.
- **Entry points:** `server.ts` (بک‌اند + serve فرانت)، `src/main.tsx` → `src/App.tsx` (فرانت، ~۷۰۰۰ خط، God component).
- **Deploy:** Vercel (`api/handler.ts` آداپتر) / Docker / PM2.

## قواعد و تصمیم‌های معماری (مهم — رعایت کن)
1. **PostgreSQL تنها منبع حقیقت است.** هیچ fallback فایل JSON نیست. `requirePrisma()` اگر `DATABASE_URL` نامعتبر باشد fail-fast می‌کند. `localStorage` فقط cache آفلاین است.
2. **Audit سمت‌سرور و اجباری:** هر تغییر در هر ماژول باید در `audit_log` با before/after ثبت شود (via `AuditService`). frontend نباید audit جداگانه بزند (تکرار می‌شود). مدل audit واحد است: `AuditLog` (جدول `audit_log`).
3. **IRC متعلق به سورس است، نه ماده.** فرم مواد هیچ فیلد IRC/تاریخ IRC ندارد. IRC در فرم ثبت سورس است.
4. **Business Partners مدل تخت:** تولیدکننده و فروشنده مستقل‌اند — فروشنده به تولیدکننده وابسته نیست (`manufacturerId` self-relation حذف شد). فقط **فروشنده** ارزیابی SOP می‌شود.
5. **فایل‌های SOP تنبل (lazy):** لیست شرکا base64 حمل نمی‌کند؛ فقط `hasFile`. blob از `GET /api/business-partners/:id/documents/:key/file` گرفته می‌شود. هنگام ذخیره، فایل موجود حفظ می‌شود مگر صریحاً حذف شود.
6. **سازگاری به‌عقب:** `Vendor.status`/`grade` رشتهٔ آزادند (نه enum) تا ~۳۰ endpoint نشکند. مدل‌های موجود را فقط افزایشی تغییر بده.
7. **Theme tokens:** برای UI جدید از توکن‌ها استفاده کن (`bg-card`, `text-foreground`, `text-muted-foreground`, `bg-muted`, `border-border`, `bg-background`)، نه رنگ hardcode (`bg-white`, `bg-slate-*`, `text-slate-*`, hex روشن). dark mode با کلاس `.dark` روی `documentElement`؛ سوییچر تم در هدر (`useTheme`).
8. **انیمیشن/ناوبری (یکدست):** کلاس‌های تعریف‌شده در `index.css`: `fade-in` (۲۰۰ms), `dialog-enter` (پاپ مودال), `slide-in-drawer`, `toast-enter`, `bounce-in`, `page-transition`. **ناوبری بین صفحات** توسط `AnimatePresence`+`motion.div` (کلید `keyName`) در `renderContent` انجام می‌شود — صفحهٔ جدید نساز که خودش transition جدا بزند. **مودال‌ها:** backdrop استاندارد = `fixed inset-0 ... bg-slate-900/50 backdrop-blur-sm ... fade-in` و پنل داخل همان. از `animate-fadeIn` (تعریف‌نشده در Tailwind v4) استفاده نکن. `prefers-reduced-motion` رعایت می‌شود.

## ساختار داده (۱۲ جدول نرمال — `prisma/schema.prisma`)
- **Auth:** `users` (نقش enum، رمز hash+salt)
- **Materials:** `materials` (فیلدهای غنی: role, pharmacopoeia, iupac, ...)
- **Vendors (هسته):** `vendors`, `vendor_materials`, `evaluations`
- **Risk (FMEA):** `risk_assessments` · **Lab:** `analysis_records` · **Activity:** `activity_logs`
- **Business Partners:** `business_partners`, `supplier_evaluations`, `sop_documents`
- **Audit:** `audit_log` (canonical، کاملاً ایندکس)
- همهٔ FKها با CASCADE/SET NULL صریح. دیاگرام: artifact «نقشهٔ دیتابیس VLSE».

## الگوهای مهم کد
- **Vendor read/write:** `getVendorsList()` / `saveVendorToDb()` / `deleteVendorFromDb()` در `server.ts`. endpointها vendor object می‌سازند و به این‌ها می‌دهند؛ risk/analysis/activity در جداول نرمال round-trip می‌شوند (`persistVendorRelations`).
- **تاریخچهٔ نمرات/ارزیابی از audit بازسازی می‌شود** (بدون تغییر schema): `GET /api/vendors/:id/score-history` و `GET /api/business-partners/:id/evaluation-history` → afterData را استخراج می‌کنند.
- **auth frontend:** `authFetch` (توکن از localStorage، روی 401/403 لاگ‌اوت). افکت‌های fetch که به endpoint auth-گیت‌شده می‌زنند باید به `currentUser` مشروط باشند (وگرنه حلقهٔ reload در صفحهٔ ورود).

## توسعه، تست، دستورها
```bash
bun install                 # نصب (پروژه از bun.lock استفاده می‌کند)
./node_modules/.bin/tsc --noEmit          # typecheck (== npm run lint)
./node_modules/.bin/vite build            # build فرانت (تأیید UI)
./node_modules/.bin/tsx --test tests/*.test.ts   # تست‌ها
```
**تست زندهٔ محلی (این محیط docker ندارد، postgres را با کاربر `postgres` اجرا کن):**
```bash
export PGDATA=/tmp/pgdata_vlse; rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chown -R postgres:postgres "$PGDATA"
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $PGDATA -U postgres --auth=trust -E UTF8"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $PGDATA -l /tmp/pg.log -o '-p 5433' start"
su postgres -c "/usr/lib/postgresql/16/bin/createdb -p 5433 vlse"
export DATABASE_URL="postgresql://postgres@localhost:5433/vlse?schema=public" JWT_SECRET=k DISABLE_HMR=true
./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsx prisma/seed.ts
psql -U postgres -h localhost -p 5433 -d vlse -c "UPDATE users SET must_change_password=false WHERE username='admin';"
setsid ./node_modules/.bin/tsx server.ts >/tmp/vlse_server.log 2>&1 </dev/null & disown   # http://localhost:3000
# لاگین تست: admin / 123
```
**اسکرین‌شات با مرورگر:** Chromium در `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`؛ `playwright-core` را موقت نصب کن (`bun add playwright-core`) و بعد `bun install` برای بازگرداندن. برای dark mode: `document.documentElement.classList.add('dark')`.
**پاک‌سازی pkill:** هرگز `pkill -f "tsx"` نزن (خودِ shell را می‌کشد)؛ با PID بکش: `for pid in $(pgrep -f 'bin/tsx'); do [ "$pid" != "$$" ] && kill $pid; done`.

## دپلوی (Vercel)
- **Build:** `npm run build` (vite build + esbuild → `dist/server.cjs`). آداپتر: `api/handler.ts`، پیکربندی: `vercel.json`.
- **env لازم روی Vercel:** `DATABASE_URL` (PostgreSQL معتبر مثل Neon/Supabase) و `JWT_SECRET`.
- **DB:** قبل از استفاده `prisma migrate deploy` را روی همان `DATABASE_URL` اجرا کن. کاربران پیش‌فرض روی اولین cold start (اگر جدول users خالی باشد) خودکار seed می‌شوند.
- **لاگین روی Vercel:** `admin / 123456` (از `DEFAULT_USERS` در `server.ts`) با `mustChangePassword: true` — اولین ورود، تغییر رمز خواسته می‌شود. (محلی با `prisma/seed.ts` رمز `123` است.)

## Git / تحویل
- **برنچ کاری:** برنچ جاری در `STATUS.md` ذکر شده (فعلاً `claude/vlse-modules-p3`). روی همان کار کن و push کن؛ برای ادامهٔ کار PR جدید به `main` بزن.
- **PRهای merge‌شده:** #2 (نرمال‌سازی دیتابیس)، #3 (بهبود ماژول‌ها) — همه در `main`.
- هر تغییر: typecheck + build + تست زنده (در صورت لمس backend) → commit با پیام واضح → push. **`STATUS.md` را بعد از هر تغییر به‌روزرسانی کن.**
- push گاهی 502 می‌دهد؛ با backoff retry کن.

## باگ موجود از قبل (مربوط به کار ما نیست)
- تست `businessRules.test.ts` → «SOP grade boundary» fail می‌شود (باگ منطقی در `sopEvaluation`). دست‌نخورده مانده.

## بدهی امنیتی گزارش‌شده (فاز ۱ — هنوز انجام نشده)
secretها در `docker-compose.yml`، JWT پیش‌فرض hardcode، PBKDF2 با ۱۰۰۰ iteration، نبود helmet/rate-limit، JWT در localStorage.
