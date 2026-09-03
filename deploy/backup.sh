#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# پشتیبان‌گیری از پایگاه‌دادهٔ VLSE.
#
#   ./deploy/backup.sh [مسیر مقصد]     # پیش‌فرض: ./backups
#
# خروجی یک فایل فشردهٔ pg_dump با مهر زمانی است. برای یک سامانهٔ GxP این
# پشتیبان تنها نسخهٔ قابل بازگردانی از سوابق است: حجم داده کوچک است، پس
# روزانه گرفتن آن هزینه‌ای ندارد. یک نمونهٔ زمان‌بندی در crontab:
#
#   0 2 * * *  cd /opt/vlse && ./deploy/backup.sh /var/backups/vlse >> /var/log/vlse-backup.log 2>&1
#
# پشتیبان را روی همان دیسک سرور تنها نگه ندارید.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:-./backups}"
mkdir -p "$DEST"

# shellcheck disable=SC1091
set -a; . ./.env; set +a
: "${POSTGRES_USER:?POSTGRES_USER در .env نیست}"
: "${POSTGRES_DB:?POSTGRES_DB در .env نیست}"

STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DEST/vlse-${STAMP}.sql.gz"

docker compose exec -T postgres_server \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists \
  | gzip > "$FILE"

# یک دامپ خالی یعنی پشتیبان‌گیری شکست خورده ولی صدایش درنیامده.
SIZE=$(wc -c < "$FILE")
if [ "$SIZE" -lt 1024 ]; then
  rm -f "$FILE"
  echo "✖ پشتیبان‌گیری ناموفق بود (خروجی خالی). سرویس پایگاه‌داده بالاست؟" >&2
  exit 1
fi

echo "✔ پشتیبان ساخته شد: $FILE ($((SIZE / 1024)) کیلوبایت)"
