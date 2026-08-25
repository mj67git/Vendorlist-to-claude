# CLAUDE.md — راهنمای پروژه برای سشن‌های آینده

> این فایل، حافظهٔ پروژه برای Claude است. قبل از هر کاری این را بخوان.
> فایل هم‌تیمی: **`STATUS.md`** — وضعیت زندهٔ کارها و نقشهٔ راه.

## پروژه چیست
**VLSE** (Vendor List & Supplier Evaluation System) — سامانهٔ ارزیابی و رتبه‌بندی کیفی تأمین‌کنندگان دارویی (GxP/GMP). رابط کاربری **فارسی و RTL**.

## استک فنی
- **Frontend:** React 19 + Vite 6 + TypeScript، Tailwind CSS 4، shadcn/ui (Radix)، lucide-react، recharts، motion، فونت Vazirmatn.
- **Backend:** Express 5 در `server.ts` (مونولیت، ~۳۴۰۰ خط)، Prisma 5 → **PostgreSQL**.
- **Entry points:** `server.ts` (بک‌اند + serve فرانت)، `src/main.tsx` → `src/App.tsx` (فرانت، ~۱۷۰۰ خط — فقط تابع `App()`: state ناوبری، sync، و `renderContent`).
  - **کامپوننت‌ها فایل خودشان را دارند** — چیز جدیدی داخل `App.tsx` ننویس:
    - `src/components/views/` → `HomeView`, `CategoryView`, `MaterialGroup`, `MaterialsComparisonSection`, `ArchiveView`, `SupplierAuditView`
    - `src/components/vendor/` → `VendorDetail`, `VendorForm`, `EvaluationForm`, `RiskAssessmentForm` (+`RiskHeatmap`)
    - `src/constants/` → `categories.ts` (`categoryLabels`), `evaluationLayout.ts`, `categoryCardStyles.ts` · `src/utils/scoreUtils.ts`
- **Deploy:** Vercel (`api/handler.ts` آداپتر) / Docker / PM2.

## قواعد و تصمیم‌های معماری (مهم — رعایت کن)
1. **PostgreSQL تنها منبع حقیقت است.** هیچ fallback فایل JSON نیست. `requirePrisma()` اگر `DATABASE_URL` نامعتبر باشد fail-fast می‌کند. `localStorage` فقط cache آفلاین است.
2. **Audit سمت‌سرور و اجباری:** هر تغییر در هر ماژول باید در `audit_log` با before/after ثبت شود (via `AuditService`). frontend نباید audit جداگانه بزند (تکرار می‌شود). مدل audit واحد است: `AuditLog` (جدول `audit_log`).
3. **IRC متعلق به سورس است، نه ماده.** فرم مواد هیچ فیلد IRC/تاریخ IRC ندارد. IRC در فرم ثبت سورس است.
4. **Business Partners مدل تخت:** تولیدکننده و فروشنده مستقل‌اند — فروشنده به تولیدکننده وابسته نیست (`manufacturerId` self-relation حذف شد). فقط **فروشنده** ارزیابی SOP می‌شود.
5. **فایل‌های SOP تنبل (lazy):** لیست شرکا base64 حمل نمی‌کند؛ فقط `hasFile`. blob از `GET /api/business-partners/:id/documents/:key/file` گرفته می‌شود. هنگام ذخیره، فایل موجود حفظ می‌شود مگر صریحاً حذف شود.
6. **سازگاری به‌عقب:** `Vendor.status`/`grade` رشتهٔ آزادند (نه enum) تا ~۳۰ endpoint نشکند. مدل‌های موجود را فقط افزایشی تغییر بده.
7. **Theme tokens:** برای UI جدید از توکن‌ها استفاده کن (`bg-card`, `text-foreground`, `text-muted-foreground`, `bg-muted`, `border-border`, `bg-background`)، نه رنگ hardcode (`bg-white`, `bg-slate-*`, `text-slate-*`, hex روشن). dark mode با کلاس `.dark` روی `documentElement`؛ سوییچر تم در هدر (`useTheme`).
8. **هر لایهٔ روی صفحه از `FormModal` می‌آید (`src/components/FormModal.tsx`).** backdrop، Esc، کلیک بیرون، قفل اسکرول، focus trap و انیمیشن **متقارن** ورود/خروج آنجاست — مودال دستی نساز. سه اندازه: `sm` تأییدیه، `md` فرم تک‌منظوره، `lg` فرم کامل رکورد.
   - کالر باید `<FormModal open={...}>` را **بدون شرط** رندر کند (نه `{cond && <FormModal/>}`)، وگرنه `AnimatePresence` انیمیشن خروج را نمی‌بیند.
   - **children حتی وقتی بسته است ارزیابی می‌شوند.** اگر محتوا به رکوردی وابسته است که ممکن است null باشد، داخل children گاردش کن (`{entity && (<>…</>)}`) وگرنه صفحه crash می‌کند.
   - تأییدیه‌های مخرب: `closeOnBackdrop={false}` بگذار (Esc همچنان لغو می‌کند).
   - استثناها: `CommandPalette`، `PrintableForms` (نمای چاپ)، پاپ‌اورهای انکرشده (اعلان‌ها، منوی کاربر) و اسکریم سایدبار موبایل.
   - **چرا این قاعده اجباری است (نه سلیقه‌ای):** هر view داخل `motion.div` صفحه‌گردانی رندر می‌شود که روی **`filter`** انیمیت می‌کند، و یک `filter` غیر از `none` هم **containing block** برای فرزندان `position: fixed` می‌سازد و هم یک **stacking context**. پس overlay دست‌سازِ `fixed inset-0` داخل یک view، به‌جای viewport نسبت به جعبهٔ صفحه چیده می‌شود و z-indexش زیر هدر اصلی (`sticky z-10`) حبس می‌شود — هرچقدر هم بالا باشد. `FormModal` با `createPortal` به `document.body` می‌رود و از هر دو فرار می‌کند. استثناهای بالا هم دقیقاً به همین دلیل یا portal می‌زنند (`PrintableForms`) یا بیرون از `<main>` رندر می‌شوند (`CommandPalette`).

8b. **فرم سورس یک صفحه است، نه مودال:** مسیرهای `#/category/<cat>/new` و `#/category/<cat>/vendor/<id>/edit`. چون خودش دیالوگ باز می‌کند، مودال‌کردنش «مودال داخل مودال» می‌ساخت. محافظ تغییرات ذخیره‌نشده داخل `VendorForm` ثبت می‌شود (dirty-check واقعی، نه صرفِ باز بودن فرم).
   - `handleSelectVendor` هنگام push باید `formMode: null` بگذارد و اگر از صفحهٔ فرم می‌آید آن ورودی را **جایگزین** کند؛ وگرنه رکورد تازه‌ساخته `formMode` را ارث می‌برد و دوباره فرم رندر می‌شود.
   - خروج بعد از ذخیره با `closeSourceForm`/ناوبری صریح است، نه `history.back()` — پشت صفحهٔ فرم لزوماً لیست نیست.

9. **انیمیشن/ناوبری (یکدست):** کلاس‌های تعریف‌شده در `index.css`: `fade-in` (۲۰۰ms), `dialog-enter` (پاپ مودال), `slide-in-drawer`, `toast-enter`, `bounce-in`, `page-transition`. **ناوبری بین صفحات** توسط `AnimatePresence`+`motion.div` (کلید `keyName`) در `renderContent` انجام می‌شود — صفحهٔ جدید نساز که خودش transition جدا بزند. **مودال‌ها:** backdrop استاندارد = `fixed inset-0 ... bg-slate-900/50 backdrop-blur-sm ... fade-in` و پنل داخل همان. از `animate-fadeIn` (تعریف‌نشده در Tailwind v4) استفاده نکن. `prefers-reduced-motion` رعایت می‌شود.

10. **مدل ناوبری (`src/App.tsx`) — رعایت کن:** منبع حقیقتِ ناوبری، استکِ `viewHistory` است (persist در localStorage با کلید `app_viewHistory`).
   - `navigate()` رفتار **تعویض تب** دارد نه drill-down: اگر مقصد در stack باشد به آن unwind می‌شود (ورودی تکراری push نکن). `handleSelectVendor()` یک سطح push می‌کند، `goBack()` یک سطح pop، `goToHistoryIndex(i)` پرش مستقیم (breadcrumb).
   - **همهٔ** مسیرهای ناوبری باید از `runGuarded()` رد شوند تا محافظ «تغییرات ذخیره‌نشده» کار کند. صفحهٔ جزئیاتِ جدید که فرم ویرایش دارد باید `registerNavGuard(() => isDirty)` را در `useEffect` ثبت و در cleanup با `null` پاک کند.
   - `expandedMaterial` داخل ورودیِ `viewHistory` زندگی می‌کند (نه state جدا) تا با بازگشت و reload حفظ شود.
   - **هوک‌های ناوبری باید بالای early-return‌های لاگین/تغییر رمز بمانند** وگرنه ترتیب هوک‌ها می‌شکند (`Rendered more hooks…`). برای دسترسی به توابعی که پایین‌تر تعریف می‌شوند از ref استفاده کن (الگوی `goBackRef`).
   - **مسیریابی hash (`src/utils/navRoutes.ts`):** URL منبع حقیقتِ «کاربر کجاست» است — `#/`, `#/materials`, `#/category/foreign`, `#/category/foreign?m=<ماده>`, `#/category/foreign/vendor/<id>`. عمداً hash است نه path، چون روی سرور داخلی شرکت به rewrite نیاز ندارد (هرچند `vercel.json` از قبل catch-all دارد). هر view جدید باید در `encodeRoute`/`decodeRoute` هم اضافه شود، وگرنه لینکش قابل اشتراک نیست.
   - هر push در استک یک ورودی **واقعی** در تاریخچهٔ مرورگر می‌سازد؛ `goBack`/`goToHistoryIndex` به `history.back()`/`go(-n)` واگذار می‌کنند و **تنها جایی که استک را عقب می‌برد `popstate` است**. پس Back، Forward و منوی تاریخچهٔ مرورگر همگی بومی کار می‌کنند. (الگوی قدیمی sentinel حذف شد.)
   - برای جلوگیری از حلقه، `applyingUrlRef` هنگام اعمال تغییرِ آمده از URL ست می‌شود؛ `pushedEntriesRef` می‌شمارد چند ورودی ساخته‌ایم تا در دیپ‌لینک (که ورودی مرورگر ندارد) Back کاربر را از سایت بیرون نیندازد.
   - لینک فقط `id` سورس را حمل می‌کند؛ رکورد کامل از `db` بازسازی می‌شود. تا رسیدن داده `vendorLinkPending` حالت loading نشان می‌دهد و اگر id واقعاً نبود پیام «سورس یافت نشد» — رکورد ناقص رندر نکن. بعد از رسیدن داده، stub روی استک با رکورد واقعی جایگزین می‌شود تا breadcrumb نام درست را نشان دهد.
   - hash نامعتبر → خانه (نه بازیابی موقعیت کش‌شدهٔ قبلی).
   - سقف استک `MAX_VIEW_HISTORY = 25`؛ در localStorage فقط snapshot سبکِ vendor ذخیره کن (رکورد کامل از `db` با id بازسازی می‌شود).

11. **وضعیت «مردود/لیست سیاه» محاسبه‌شونده است، نه ذخیره‌شونده (`src/utils/vendorState.ts`).**
   - تنها منبع تصمیم `isVendorRejected(v)` است؛ همه‌جا (دونات داشبورد، کارت‌ها، بج سایدبار، فیلتر دسته‌بندی، آرشیو، اکسل) باید از همین استفاده کند — شرط دستیِ `status==='rejected' || grade==='rejected'` ننویس.
   - **`grade` هرگز ورودی این تصمیم نیست، فقط خروجی است.** قبلاً `grade='rejected'` یک قفل یک‌طرفه بود: با حذف نتیجهٔ آزمایش، `status` برمی‌گشت ولی `grade` نه، و برای سورس‌ها حتی `status` را هم به عقب می‌کشید.
   - واقعیت‌ها: نمونه با **یک** رکورد Reject سیاه می‌شود؛ سورس فقط با تصمیم صریح (باکس ادمین یا فرم). دلایلِ با پیشوند «مردود در آزمون QC» فقط بازتاب رکوردها هستند و به‌تنهایی نگه‌دارندهٔ وضعیت نیستند.
   - `applyDerivedState(v)` idempotent است و در `normalizeAndCleanVendor` روی هر load/save اجرا می‌شود، پس دادهٔ قدیمیِ قفل‌شده خودش ترمیم می‌شود.

12. **PATCHهای سورس باید ترتیبی (sequential) بمانند.** هر endpoint (`/profile`, `/contact`, `/scores`, `/analysis`, `/logs`, `/risk`) کل vendor را read-modify-write می‌کند؛ اگر دوتا هم‌زمان در پرواز باشند، کندتری نسخهٔ کهنهٔ خودش را برمی‌گرداند و **دادهٔ حذف‌شده زنده می‌شود**. در `handleUpdateVendor` صفِ `syncQueue` با `await` پشت‌سرهم اجرا می‌شود — موازی نکن.

13. **رابریک گرید SOP تثبیت‌شده است (`src/utils/sopEvaluation.ts`):** امتیاز هر مدرک Approved=20 / Permit Approval=10 / Expired=5 / Not Submitted=0، و مرزهای گرید **۸۰ / ۶۰ / ۴۰ / ۳۰** → `A, B, C, Pending Review, Blacklist`. **گرید `D` وجود ندارد** (واژگان قدیمی بود و حذف شد). این قوانین را در جای دیگری کپی نکن — از `computeSupplierEvaluation` و `calculateGradeAndStatus` استفاده کن.
   - `reconcileSupplierEvaluation` روی load اجرا می‌شود تا ارزیابی ذخیره‌شدهٔ ناسازگار با مدارکش خودترمیم شود؛ `updatedAt/updatedBy` عمداً حفظ می‌شود تا محاسبهٔ مجدد شبیه ارزیابی تازهٔ انسانی نباشد.
   - نکته: `getRankParams` (سورس‌ها) گرید `D` دارد ولی مقیاس دیگری است (A: ۸۰-۱۰۰ … D: ۰-۳۹) و به SOP ربطی ندارد.

14. **دسترسی سمت‌سرور اجباری است، نه سمت‌کلاینت.** گیت‌های `role === 'admin'` در فرانت فقط برای UX‌اند (چون `currentUser` از localStorage می‌آید و قابل ویرایش است). هر endpoint حساس باید `requireAuth` + `requireRole('admin')` داشته باشد (`server.ts`).
   - **۴۰۱ و ۴۰۳ معنای متفاوت دارند:** `requireAuth` برای توکن نامعتبر **۴۰۱** می‌دهد و `authFetch` روی آن نشست را پاک می‌کند؛ `requireRole` برای عدم مجوز **۴۰۳** می‌دهد و `authFetch` نباید کاربر را خارج کند. (قبلاً ۴۰۳ هم خروج می‌داد و چون داشبورد فید ادمین‌ویژهٔ audit را صدا می‌زند، هیچ کاربر غیرادمینی نمی‌توانست وارد شود.)
   - **جدول سیاست واحد `src/utils/permissions.ts`** — هم `server.ts` و هم کامپوننت‌ها از همین می‌خوانند. **شرط نقش دستی ننویس**؛ از `can(role, permission)` و `canScoreDepartment(role, dept)` استفاده کن، وگرنه UI و سرور دوباره واگرا می‌شوند (همان چیزی که باعث شد دکمه‌ها مخفی باشند ولی endpoint اجازه بدهد).
     - ماتریس: `admin` همه · `commercial` = `vendor.write` + `partner.write` + `score.commercial` · `qa` = `vendor.analysis` + `material.write` + `score.qa` · `planning`/`finance` فقط `score.<خودشان>` · `lab` هیچ (در enum مانده چون حذفش مهاجرت می‌خواهد).
     - **نقش فقط الگوست.** `users.permissions` (JSON) استثنای پر‌کاربر است: **خالی = از نقش پیروی کن** (وضعیت همهٔ کاربران قدیمی، پس مهاجرت لازم نبود)، پرشده = همان فهرست **جایگزین** الگو می‌شود. `can(user, perm)` کاربر می‌گیرد نه رشتهٔ نقش.
     - **`requirePermission` رکورد کاربر را از دیتابیس می‌خواند، نه از JWT.** توکن هفت‌روزه است و فقط `role` دارد؛ اگر از توکن خوانده شود تغییر دسترسی تا یک هفته اثر نمی‌کند. هزینه‌اش یک کوئری با کلید اصلی روی درخواست‌های نوشتنی است.
     - تغییر نقش، استثناها را پاک می‌کند (وگرنه استثنای شغل قبلی بی‌صدا دنبال کاربر می‌آید). `checkPermissionSafety` نمی‌گذارد آخرین دارندهٔ `users.manage` یا خودِ کاربر آن را از دست بدهد.
     - **امتیازدهی گارد ساده ندارد:** `PATCH /api/vendors/:id/scores` کل شیء را جایگزین می‌کند، پس هندلر با `forbiddenScoreChanges`/`forbiddenRawScoreChanges` payload را با مقدار ذخیره‌شده مقایسه می‌کند. «ثبت‌نشده» و «صفر» عمداً یکی حساب می‌شوند، وگرنه فرم (که برای دپارتمان‌های غیرقابل‌ویرایش صفر می‌فرستد) روی سورس بدون امتیاز رد می‌شد.
   - **ماژول کاربران:** `src/components/UsersView.tsx` (مسیر `#/users`، ادمین‌ویژه). `checkAdminSafety` در `server.ts` جلوی قفل‌شدن کل سازمان را می‌گیرد: ادمین نمی‌تواند خودش را حذف/غیرفعال/تنزل دهد و آخرین مدیر فعال حذف نمی‌شود.

15. **نام موجودیت‌ها (سورس/ماده/شریک) هرگز بی‌صدا بریده نمی‌شود.** از `src/components/EntityName.tsx` استفاده کن، نه `truncate` دستی. ترتیب اولویت: (۱) سقف عرض نگذار و بگذار جا بیفتد، (۲) `lines={2}` برای شکستن به دو خط، (۳) برش + tooltip — فقط جایی که ارتفاع سطر واقعاً ثابت است، و **هیچ‌وقت بدون tooltip**. نام فارسی معمولاً ۲۰–۳۰ کاراکتر و لاتین تا ۴۰ است؛ در `text-xs` یعنی ~۲۱۰–۲۶۰px.
   - **`truncate` را روی ظرف `flex` نگذار.** `text-overflow` به فرزندان flex اعمال نمی‌شود، پس متن **بدون «…» سخت بریده می‌شود** و کاربر اصلاً نمی‌فهمد نام ناقص است. `truncate`/`line-clamp` فقط روی خودِ عنصر متن.
   - بج‌ها و چیپ‌های کنار نام باید `shrink-0` باشند **و** در ظرفی با `flex-wrap`، وگرنه چون بج‌ها کوچک نمی‌شوند تمام فشار روی نام می‌افتد (در نمودار مقایسه، از ۱۸۰px مشترک گاهی فقط ~۷۷px به نام می‌رسید).
   - `TooltipContent` باید در `TooltipPrimitive.Portal` باشد — به همان دلیلِ `FormModal` (قاعدهٔ ۸): انیمیشن `filter` در صفحه‌گردانی هم containing block و هم stacking context می‌سازد. `TooltipProvider` در `src/main.tsx` نصب شده (نه `App.tsx`، چون App برای صفحهٔ ورود early-return دارد و Radix بدون Provider خطا می‌دهد).
   - **`useIsOverflowing` عمداً callback ref دارد، نه `useRef`.** وصل‌شدن tooltip عنصر را جابه‌جا می‌کند، پس React گرهٔ اندازه‌گیری‌شده را unmount و گرهٔ تازه mount می‌کند؛ با ref معمولی، `ResizeObserver` روی گرهٔ جدا‌شده می‌ماند، آن گره `0x0` گزارش می‌دهد و tooltip بی‌صدا خاموش می‌شود. اندازه‌گیریِ گرهٔ جداشده یا صفر‌اندازه دور ریخته می‌شود.

## ساختار داده (۱۲ جدول نرمال — `prisma/schema.prisma`)
- **Auth:** `users` (نقش enum، رمز hash+salt)
- **Materials:** `materials` (فیلدهای غنی: role, pharmacopoeia, iupac, ...)
- **Vendors (هسته):** `vendors`, `vendor_materials`, `evaluations`
- **Risk (FMEA):** `risk_assessments` · **Lab:** `analysis_records` · **Activity:** `activity_logs`
- **Business Partners:** `business_partners`, `supplier_evaluations`, `sop_documents`
- **Audit:** `audit_log` (canonical، کاملاً ایندکس)
- **انتخاب سورس:** `source_selections` (یکتا روی `material_key + category`؛ تصمیم انسانیِ «سورس برندهٔ این ماده» با دلیل الزامی. موتور امتیازدهی فقط **پیشنهاد** می‌دهد — پیشنهاد را تصمیم ثبت‌شده حساب نکن.)
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
./node_modules/.bin/tsx --test tests/*.test.ts   # تست‌ها (اکنون ۸۱ مورد)
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
**مهم هنگام تست زنده:** `server.ts` فرانت را از طریق **Vite dev middleware** سرو می‌کند (نه `dist/`). پس `vite build` روی چیزی که مرورگر می‌بیند اثر ندارد و اگر فایل جدیدی اضافه کردی، **سرور را ری‌استارت کن** وگرنه کد قدیمی را تست می‌کنی.

**اسکرین‌شات با مرورگر:** Chromium در `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`؛ `playwright-core` را موقت نصب کن (`bun add playwright-core`) و بعد `bun install` برای بازگرداندن. برای dark mode: `document.documentElement.classList.add('dark')`.
**پاک‌سازی pkill:** هرگز `pkill -f "tsx"` نزن (خودِ shell را می‌کشد)؛ با PID بکش: `for pid in $(pgrep -f 'bin/tsx'); do [ "$pid" != "$$" ] && kill $pid; done`.

## دپلوی (Vercel)
- **Build:** `npm run build` (vite build + esbuild → `dist/server.cjs`). آداپتر: `api/handler.ts`، پیکربندی: `vercel.json`.
- **env لازم روی Vercel:** `DATABASE_URL` (PostgreSQL معتبر مثل Neon/Supabase) و `JWT_SECRET`.
- **DB:** قبل از استفاده `prisma migrate deploy` را روی همان `DATABASE_URL` اجرا کن. کاربران پیش‌فرض روی اولین cold start (اگر جدول users خالی باشد) خودکار seed می‌شوند.
- **لاگین روی Vercel:** `admin / 123456` (از `DEFAULT_USERS` در `server.ts`) با `mustChangePassword: true` — اولین ورود، تغییر رمز خواسته می‌شود. (محلی با `prisma/seed.ts` رمز `123` است.)

## Git / تحویل
- **برنچ کاری:** برنچ جاری در `STATUS.md` ذکر شده (فعلاً `claude/vlse-modules-p3`، با PR #9 باز به main). روی همان کار کن و push کن؛ برای ادامهٔ کار PR جدید به `main` بزن.
- **PRهای merge‌شده:** #2 (نرمال‌سازی دیتابیس)، #3 (بهبود ماژول‌ها) — همه در `main`.
- هر تغییر: typecheck + build + تست زنده (در صورت لمس backend) → commit با پیام واضح → push. **`STATUS.md` را بعد از هر تغییر به‌روزرسانی کن.**
- push گاهی 502 می‌دهد؛ با backoff retry کن.

## باگ موجود از قبل (مربوط به کار ما نیست)
- **`database/vendors.json` خالی است** (همهٔ کلیدها `{}`)، پس `prisma/seed.ts` با پیام «✅ Seeding completed» تمام می‌شود ولی **۰ سورس/ماده** درج می‌کند — فقط کاربران seed می‌شوند. برای تست UI باید دستی داده ساخت. سریع‌ترین راه، درج مستقیم در دیتابیس است (POST `/api/vendors` اعتبارسنجی سخت‌گیری دارد):
  ```sql
  INSERT INTO materials (id,name,name_en,cas,irc) VALUES ('M-1','پاراستامول','Paracetamol','103-90-2','N/A');
  INSERT INTO vendors (id,name,name_en,country,status,grade) VALUES ('V1','شرکت الف','Alpha Co','India','new','B');
  INSERT INTO vendor_materials (id,vendor_id,material_id,is_sample,category) VALUES ('L1','V1','M-1',false,'foreign');
  ```
  **دقت:** کلیدهای دسته‌بندی `foreign|domestic|veterinary|packaging|sample|blacklist` هستند (نه `import`).
- در تست مرورگری، `.flex-1.overflow-y-auto` **دو** مورد match می‌کند؛ اولی `<nav>` سایدبار است و کانتینر محتوا دومی است (`[1]`).

## بدهی امنیتی گزارش‌شده (فاز ۱ — هنوز انجام نشده)
secretها در `docker-compose.yml`، JWT پیش‌فرض hardcode، PBKDF2 با ۱۰۰۰ iteration، نبود helmet/rate-limit، JWT در localStorage.
