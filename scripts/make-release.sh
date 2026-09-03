#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# ساخت بستهٔ تحویلی VLSE برای واحد IT.
#
#   ./scripts/make-release.sh 1.0.0
#
# خروجی: dist-release/VLSE-<نسخه>.zip
#
# بسته از فایل‌های ردیابی‌شدهٔ گیت ساخته می‌شود (`git archive`)، پس هرچه در
# .gitignore است — از جمله .env و node_modules و dist — هرگز واردش نمی‌شود.
# بعد از استخراج، فایل‌های کاری توسعه حذف می‌شوند: بستهٔ IT جای CLAUDE.md و
# STATUS.md و تاریخچهٔ کار نیست.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-}"
[ -n "$VERSION" ] || { echo "استفاده: ./scripts/make-release.sh <نسخه>   مثلاً 1.0.0" >&2; exit 1; }

OUT="dist-release"
STAGE="$OUT/VLSE-$VERSION"
rm -rf "$STAGE" "$OUT/VLSE-$VERSION.zip"
mkdir -p "$STAGE"

git archive HEAD | tar -x -C "$STAGE"

# فایل‌های کاری توسعه در بستهٔ استقرار جایی ندارند.
rm -rf "$STAGE/CLAUDE.md" "$STAGE/STATUS.md" "$STAGE/.claude" "$STAGE/tests" \
       "$STAGE/.github" "$STAGE/metadata.json" "$STAGE/bun.lock"

printf '%s\n' "$VERSION" > "$STAGE/VERSION"
git rev-parse HEAD > "$STAGE/COMMIT"

# راهنمای IT سرِ در بسته باشد، نه گوشه‌اش.
cp "$STAGE/deploy/README-IT.md" "$STAGE/README.md"

( cd "$OUT" && zip -qr "VLSE-$VERSION.zip" "VLSE-$VERSION" )
rm -rf "$STAGE"

echo "✔ بسته ساخته شد: $OUT/VLSE-$VERSION.zip"
unzip -l "$OUT/VLSE-$VERSION.zip" | tail -1
