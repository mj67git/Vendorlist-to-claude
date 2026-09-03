#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# بازگردانی پایگاه‌دادهٔ VLSE از یک فایل پشتیبان.
#
#   ./deploy/restore.sh backups/vlse-20260903-020000.sql.gz
#
# ⚠️ این عملیات محتوای فعلی پایگاه‌داده را با محتوای فایل پشتیبان جایگزین
# می‌کند. پیش از اجرا تأیید صریح می‌گیرد و سرویس برنامه را موقتاً می‌خواباند
# تا نوشتنی در میانهٔ بازگردانی رخ ندهد.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-}"
[ -n "$FILE" ] || { echo "استفاده: ./deploy/restore.sh <فایل پشتیبان .sql.gz>" >&2; exit 1; }
[ -f "$FILE" ] || { echo "فایل پیدا نشد: $FILE" >&2; exit 1; }

# shellcheck disable=SC1091
set -a; . ./.env; set +a
: "${POSTGRES_USER:?POSTGRES_USER در .env نیست}"
: "${POSTGRES_DB:?POSTGRES_DB در .env نیست}"

echo "⚠️  دادهٔ فعلی پایگاه‌داده «$POSTGRES_DB» با محتوای $FILE جایگزین می‌شود."
printf 'برای ادامه عبارت YES را تایپ کنید: '
read -r CONFIRM
[ "$CONFIRM" = "YES" ] || { echo "لغو شد."; exit 1; }

echo "توقف موقت سرویس برنامه..."
docker compose stop pharma-app

gunzip -c "$FILE" | docker compose exec -T postgres_server \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1

echo "راه‌اندازی دوبارهٔ سرویس..."
docker compose start pharma-app

echo "✔ بازگردانی انجام شد. صحت داده را در خود سامانه بررسی کنید."
