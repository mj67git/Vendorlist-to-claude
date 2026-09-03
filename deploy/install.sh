#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# نصب VLSE روی سرور داخلی — یک دستور، از صفر تا سرویس بالا.
#
#   sudo ./install.sh
#
# چه می‌کند:
#   ۱. پیش‌نیازها را می‌سنجد (Docker و Docker Compose v2).
#   ۲. اگر .env نبود، می‌سازد و رمز پایگاه‌داده و کلید امضای نشست را خودش
#      به‌صورت تصادفی تولید می‌کند. اگر .env بود، دست نمی‌زند.
#   ۳. تصویر را می‌سازد و سرویس‌ها را بالا می‌آورد.
#   ۴. منتظر می‌ماند تا /api/health بگوید پایگاه‌داده پاسخ می‌دهد.
#   ۵. آدرس ورود و مشخصات حساب اولیه را چاپ می‌کند.
#
# اجرای دوباره‌اش بی‌خطر است: همان .env و همان دادهٔ پایگاه‌داده می‌ماند و فقط
# نسخهٔ تازه جایگزین می‌شود (به‌روزرسانی از همین مسیر انجام می‌شود).
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/.."

RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; BOLD=$'\e[1m'; OFF=$'\e[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✔%s %s\n' "$GREEN" "$OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$OFF" "$*"; }
die()  { printf '%s✖ %s%s\n' "$RED" "$*" "$OFF" >&2; exit 1; }

say "${BOLD}نصب سامانهٔ VLSE${OFF}"
say "---------------------------------------------"

# --- ۱. پیش‌نیازها ---------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "Docker نصب نیست. نسخهٔ ۲۴ یا بالاتر لازم است."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 در دسترس نیست (دستور: docker compose)."
docker info >/dev/null 2>&1 || die "سرویس Docker در حال اجرا نیست، یا این کاربر اجازهٔ دسترسی به آن را ندارد."
command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || die "برای بررسی سلامت سامانه به curl یا wget نیاز است."
ok "Docker: $(docker --version | cut -d' ' -f3 | tr -d ,) · Compose: $(docker compose version --short)"

# --- ۲. پیکربندی -----------------------------------------------------------
random_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -base64 "$1"
  else head -c "$1" /dev/urandom | base64; fi
}

if [ -f .env ]; then
  ok ".env موجود است؛ دست‌نخورده ماند."
else
  [ -f .env.example ] || die ".env.example پیدا نشد؛ بسته ناقص است."
  cp .env.example .env
  DB_PASS="$(random_secret 24 | tr -d '\n/+=' | cut -c1-32)"
  JWT="$(random_secret 48 | tr -d '\n')"
  # sed با جداکنندهٔ | چون مقدارها می‌توانند / داشته باشند.
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${DB_PASS}|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" .env
  sed -i "s|^DATABASE_URL=.*|# DATABASE_URL توسط docker compose از مقادیر POSTGRES_* ساخته می‌شود.|" .env
  chmod 600 .env
  ok ".env ساخته شد و رمز پایگاه‌داده و کلید نشست به‌صورت تصادفی تولید شد."
  warn "از .env نسخهٔ پشتیبان بگیرید و آن را جای امن نگه دارید؛ بدون کلید، نشست‌های موجود باطل می‌شوند."
fi

# shellcheck disable=SC1091
set -a; . ./.env; set +a
APP_PORT="${APP_PORT:-8080}"

# --- ۳. بالا آوردن سرویس ---------------------------------------------------
say ""
say "${BOLD}ساخت تصویر و راه‌اندازی سرویس‌ها...${OFF} (بار اول چند دقیقه طول می‌کشد)"
docker compose up -d --build

# --- ۴. انتظار برای سلامت --------------------------------------------------
say ""
printf 'در انتظار آماده شدن سامانه'
for i in $(seq 1 60); do
  # هر سروری یکی از این دو را دارد؛ نصب نباید سر نبودن curl بخوابد.
  if { command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:${APP_PORT}/api/health" >/dev/null 2>&1; } \
     || { command -v wget >/dev/null 2>&1 && wget -q -O /dev/null "http://127.0.0.1:${APP_PORT}/api/health" 2>/dev/null; }; then
    printf '\n'; ok "سامانه پاسخ می‌دهد و پایگاه‌داده در دسترس است."
    break
  fi
  printf '.'
  sleep 3
  if [ "$i" -eq 60 ]; then
    printf '\n'
    die "سامانه در ۳ دقیقه بالا نیامد. لاگ را ببینید:  docker compose logs --tail=100 pharma-app"
  fi
done

# --- ۵. گزارش نهایی --------------------------------------------------------
say ""
say "---------------------------------------------"
ok "${BOLD}نصب کامل شد.${OFF}"
say "آدرس سامانه:      http://$(hostname -f 2>/dev/null || hostname):${APP_PORT}/"
say "حساب اولیه:        admin / 123456"
say ""
warn "همان اولین ورود، رمز مدیر عوض می‌شود (سامانه خودش می‌خواهد). رمز اولیه را در ایمیل یا تیکت نفرستید."
warn "سامانه روی HTTP سرو می‌شود؛ پیش از استفادهٔ واقعی، یک reverse proxy با گواهی TLS جلوی آن بگذارید."
say ""
say "دستورهای روزمره:"
say "  وضعیت:        docker compose ps"
say "  لاگ:          docker compose logs -f pharma-app"
say "  پشتیبان‌گیری:  ./deploy/backup.sh"
say "  بازگردانی:     ./deploy/restore.sh <فایل پشتیبان>"
say "  به‌روزرسانی:   بستهٔ جدید را باز کنید و دوباره ./deploy/install.sh را بزنید"
