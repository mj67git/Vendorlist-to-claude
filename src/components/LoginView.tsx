import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, AlertTriangle } from 'lucide-react';
import { User } from '../types';
// @ts-expect-error — the bundler resolves this asset import; TypeScript does not.
import temadLogo from '../assets/logo.png';

interface LoginViewProps {
  onLogin: (user: User) => void;
}

export function LoginView({ onLogin }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Latin passwords typed on a Persian keyboard layout are the most common
  // cause of a "wrong password" that is really a stuck Caps Lock.
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Local/demo mode: sign in without any backend/database (browser localStorage only).
  // Shown when explicitly enabled (VITE_ENABLE_LOCAL_DEMO) OR automatically once a
  // login attempt reveals the backend/database is unavailable — so a no-DB test
  // deploy needs zero configuration, while a healthy production login never sees it.
  const localDemoEnabled = (import.meta as any).env?.VITE_ENABLE_LOCAL_DEMO === 'true';
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const showDemoButton = localDemoEnabled || backendUnavailable;

  const handleLocalDemoLogin = () => {
    const demoUser: User = { username: 'demo', role: 'admin', name: 'کاربر آزمایشی (لوکال)', mustChangePassword: false } as User;
    localStorage.setItem('app_local_mode', 'true');
    localStorage.setItem('app_currentUser', JSON.stringify(demoUser));
    localStorage.removeItem('app_jwt_token');
    onLogin(demoUser);
  };

  const trackCapsLock = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const on = e.getModifierState?.('CapsLock');
    if (typeof on === 'boolean') setCapsLock(on);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('نام کاربری و کلمهٔ عبور را وارد کنید.');
      return;
    }

    setLoading(true);
    setError('');

    fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
      .then(async (res) => {
        // Guard against non-JSON responses (e.g. an HTML 500 error page when the
        // server/database is misconfigured). Parsing HTML as JSON throws a cryptic
        // "The string did not match the expected pattern" on Safari/iOS.
        const raw = await res.text();
        let data: any = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch {
          // A non-JSON auth response means there is no working backend/DB.
          setBackendUnavailable(true);
          throw new Error('سرور/پایگاه‌داده در دسترس نیست. برای تست بدون دیتابیس از دکمهٔ «ورود آزمایشی» زیر استفاده کنید.');
        }
        if (!res.ok) {
          // A working backend returns a JSON { error } body (e.g. a real 401 wrong
          // password). A 404 or an empty/bodyless failure means the API/DB isn't
          // there — offer the local demo instead of a misleading credentials error.
          if (res.status === 404 || !data || typeof data.error !== 'string') {
            setBackendUnavailable(true);
            throw new Error('سرور/پایگاه‌داده در دسترس نیست. برای تست بدون دیتابیس از دکمهٔ «ورود آزمایشی» زیر استفاده کنید.');
          }
          throw new Error(data.error);
        }
        return data;
      })
      .then((data) => {
        if (data.token && data.user) {
          localStorage.setItem('app_jwt_token', data.token);
          onLogin(data.user);
        } else {
          throw new Error('پاسخ نامعتبر از سامانهٔ احراز هویت دریافت شد.');
        }
      })
      .catch((err) => {
        console.error("Login verification failed:", err);
        // A network failure (server unreachable) also means no backend/DB — offer demo.
        if (err instanceof TypeError || /Failed to fetch|NetworkError|پایگاه‌داده/i.test(err?.message || '')) {
          setBackendUnavailable(true);
        }
        setError(err.message || 'خطا در ارتباط با سامانهٔ احراز هویت.');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  // Credentials are Latin, so the two fields stay LTR; everything around them is
  // Persian and RTL like the rest of the app. The page used to be LTR end to end
  // with English labels and English error text, which made the first screen of a
  // Persian system the only English one — and stranded the Persian demo button
  // inside an LTR container.
  const fieldClass =
    'w-full bg-background border border-border rounded-lg px-3 py-2.5 text-sm text-foreground ' +
    'placeholder:text-muted-foreground text-left focus:outline-none focus:ring-1 focus:ring-ring ' +
    'focus:border-ring disabled:opacity-50 transition-colors';

  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center p-4 font-sans" dir="rtl">
      <div className="bg-card border border-border rounded-2xl p-8 max-w-sm w-full shadow-[0_8px_30px_rgba(15,23,42,0.06)] fade-in">
        <div className="text-center mb-7">
          {/* The logo is dark navy on transparent, so on the dark card it all but
              disappears. It gets a light plate in dark mode only. */}
          <span className="inline-flex items-center justify-center mb-5 dark:bg-white dark:rounded-2xl dark:px-5 dark:py-3">
            <img src={temadLogo} alt="تماد" className="h-20 w-auto object-contain" />
          </span>
          <h1 className="text-base font-bold text-foreground mb-1 leading-snug tracking-tight">
            سامانهٔ ارزیابی و رتبه‌بندی تأمین‌کنندگان
          </h1>
          <p className="text-primary text-[11px] font-semibold uppercase tracking-wider" dir="ltr">
            Vendor List &amp; Supplier Evaluation System
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4" aria-busy={loading}>
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="flex items-start gap-2 p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-700 dark:text-rose-300 text-xs leading-relaxed"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label htmlFor="username_input" className="block text-xs font-semibold text-foreground mb-1.5">
              نام کاربری
            </label>
            <input
              id="username_input"
              type="text"
              autoComplete="username"
              autoFocus
              disabled={loading}
              value={username}
              onChange={e => setUsername(e.target.value)}
              className={fieldClass}
              placeholder="admin"
              dir="ltr"
            />
          </div>

          <div>
            <label htmlFor="password_input" className="block text-xs font-semibold text-foreground mb-1.5">
              کلمهٔ عبور
            </label>
            <div className="relative">
              <input
                id="password_input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                disabled={loading}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyUp={trackCapsLock}
                onKeyDown={trackCapsLock}
                className={`${fieldClass} pl-10`}
                placeholder="••••••••"
                dir="ltr"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                aria-label={showPassword ? 'پنهان کردن کلمهٔ عبور' : 'نمایش کلمهٔ عبور'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 left-0 px-3 flex items-center text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {capsLock && (
              <p className="mt-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                کلید Caps Lock روشن است.
              </p>
            )}
          </div>

          <button
            id="login_submit_btn"
            type="submit"
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-semibold py-2.5 rounded-lg transition-colors mt-6 text-sm cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{loading ? 'در حال بررسی...' : 'ورود به سامانه'}</span>
          </button>
        </form>

        {/* Someone locked out of a system where only an admin can reset a password
            needs to be told that, on the screen where they are stuck. */}
        <p className="mt-4 text-[11px] text-muted-foreground text-center leading-relaxed">
          کلمهٔ عبور را فراموش کرده‌اید؟ بازنشانی رمز فقط توسط مدیر سیستم انجام می‌شود.
        </p>

        {showDemoButton && (
          <div className="mt-5 pt-4 border-t border-border text-center">
            <button
              type="button"
              onClick={handleLocalDemoLogin}
              className="w-full bg-card border border-primary text-primary hover:bg-primary/5 font-semibold py-2.5 rounded-lg transition-colors text-sm cursor-pointer"
            >
              ورود آزمایشی (بدون پایگاه‌داده)
            </button>
            <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
              داده‌ها فقط در همین مرورگر ذخیره می‌شوند. برای نسخهٔ نهایی، ورود عادی با پایگاه‌داده استفاده می‌شود.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
