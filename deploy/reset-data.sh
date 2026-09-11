#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# خالی‌کردن دادهٔ پیش از راه‌اندازی VLSE.
#
#   ./deploy/reset-data.sh --audit-only   # فقط سابقهٔ ممیزی (ردیابی تغییرات)
#   ./deploy/reset-data.sh --all          # سابقه + کل داده. کاربران می‌مانند.
#
# **نصب تازه به این اسکریپت نیاز ندارد.** پایگاه‌دادهٔ نو با `migrate deploy`
# ساخته می‌شود و هیچ ردیفی در آن نیست — نه داده، نه سابقه. این اسکریپت برای
# حالتی است که پیش از تحویل، روی همان پایگاه‌داده کار آزمایشی شده باشد.
#
# ⚠️ پس از شروع استفادهٔ واقعی این را اجرا نکنید. در یک سامانهٔ GxP سابقهٔ
# ممیزی خودش یک سند است؛ به همین دلیل برنامه هیچ دکمه‌ای برای پاک‌کردن آن
# ندارد و تریگر `audit_log_no_update_delete` حتی DELETE تک‌ردیفی را رد
# می‌کند. تنها راهِ باقی‌مانده TRUNCATE است و همین فایل تنها جایی است که
# پشتیبانی‌شده از آن استفاده می‌کند.
#
# پیش از اجرا پشتیبان بگیرید:  ./deploy/backup.sh
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

# جدول‌های داده. `users` عمداً اینجا نیست: حساب‌ها پاک نمی‌شوند، وگرنه پس از
# ریست هیچ‌کس نمی‌تواند وارد شود. `_prisma_migrations` هم نیست، وگرنه مهاجرت‌ها
# دوباره از صفر اجرا می‌شوند.
DATA_TABLES="source_selections, activity_logs, analysis_records, risk_assessments, evaluations, vendor_materials, sop_documents, supplier_evaluations, vendors, business_partners, materials, audit_log"
AUDIT_TABLES="audit_log"

MODE="${1:-}"
case "$MODE" in
  --audit-only) TABLES="$AUDIT_TABLES"; WHAT="سابقهٔ ممیزی" ;;
  --all)        TABLES="$DATA_TABLES";  WHAT="سابقهٔ ممیزی و کل دادهٔ برنامه (کاربران می‌مانند)" ;;
  *)
    cat >&2 <<'USAGE'
استفاده:
  ./deploy/reset-data.sh --audit-only    فقط سابقهٔ ممیزی (صفحهٔ ردیابی تغییرات)
  ./deploy/reset-data.sh --all           سابقه + سورس‌ها، مواد، شرکا و ارزیابی‌ها

حالت باید صریح باشد؛ این اسکریپت پیش‌فرض ندارد.
USAGE
    exit 2 ;;
esac

# shellcheck disable=SC1091
set -a; . ./.env; set +a
: "${POSTGRES_USER:?POSTGRES_USER در .env نیست}"
: "${POSTGRES_DB:?POSTGRES_DB در .env نیست}"

psql_run() {
  docker compose exec -T postgres_server \
    psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 "$@"
}

counts() {
  psql_run -At -c "
    SELECT 'سابقهٔ ممیزی: ' || (SELECT count(*) FROM audit_log)
        || ' · سورس: '    || (SELECT count(*) FROM vendors)
        || ' · ماده: '     || (SELECT count(*) FROM materials)
        || ' · شریک: '     || (SELECT count(*) FROM business_partners)
        || ' · کاربر: '    || (SELECT count(*) FROM users)"
}

echo "آنچه پاک می‌شود: $WHAT"
echo "وضعیت فعلی —  $(counts)"
echo
echo "⚠️ این کار برگشت‌پذیر نیست. تنها راه بازگشت، بازگرداندن یک پشتیبان است (./deploy/backup.sh)."
printf 'برای ادامه عبارت  PAAK  را تایپ کنید: '
read -r CONFIRM
[ "$CONFIRM" = "PAAK" ] || { echo "لغو شد. هیچ چیزی پاک نشد."; exit 1; }

# TRUNCATE به‌جای DELETE: تریگر فقط‌افزودنیِ `audit_log` حذف ردیفی را رد
# می‌کند و روی TRUNCATE شلیک نمی‌شود. CASCADE ترتیب کلیدهای خارجی را از سر
# راه برمی‌دارد و RESTART IDENTITY شمارنده‌ها را هم به ابتدا می‌برد.
psql_run -c "TRUNCATE TABLE $TABLES RESTART IDENTITY CASCADE"

echo
echo "✔ انجام شد —  $(counts)"
