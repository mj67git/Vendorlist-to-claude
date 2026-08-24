import React, { useState } from 'react';
import { User } from '../types';
// @ts-ignore
import temadLogo from '../assets/logo.png';

interface LoginViewProps {
  onLogin: (user: User) => void;
}

export function LoginView({ onLogin }: LoginViewProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Please enter username and password.');
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
          throw new Error('Authentication system returned an invalid response.');
        }
      })
      .catch((err) => {
        console.error("Login verification failed:", err);
        // A network failure (server unreachable) also means no backend/DB — offer demo.
        if (err instanceof TypeError || /Failed to fetch|NetworkError|پایگاه‌داده/i.test(err?.message || '')) {
          setBackendUnavailable(true);
        }
        setError(err.message || 'Error connecting to the authentication server.');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center p-4 font-sans" dir="ltr">
      <div className="bg-white border border-[#E5E5EA] rounded-2xl p-8 max-w-sm w-full shadow-[0_8px_30px_rgba(0,0,0,0.04)] fade-in text-left">
         <div className="text-center mb-8">
            <div className="flex items-center justify-center mx-auto mb-6">
               <img src={temadLogo} alt="Logo" className="h-28 w-auto object-contain" />
            </div>
            <h1 className="text-lg font-bold text-[#1D1D1F] mb-1.5 leading-snug tracking-tight">Vendor List & Supplier Evaluation System</h1>
            <p className="text-cyan-600 font-mono text-[11px] font-semibold uppercase tracking-wider">Vendor Management Portal</p>
         </div>
         <form onSubmit={handleLogin} className="space-y-4" aria-busy={loading}>
            {error && <div role="alert" aria-live="polite" className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs leading-relaxed">{error}</div>}
            <div>
               <label htmlFor="username_input" className="block text-xs font-semibold text-[#1D1D1F] mb-1">Username</label>
               <input 
                 id="username_input"
                 type="text"
                 autoComplete="username"
                 disabled={loading}
                 value={username} 
                 onChange={e=>setUsername(e.target.value)} 
                 className="w-full bg-white border border-[#D2D2D7] rounded-lg px-3 py-2 text-[#1D1D1F] focus:outline-none focus:ring-1 focus:ring-[#0071E3] focus:border-[#0071E3] text-left font-mono text-sm leading-none disabled:opacity-50" 
                 placeholder="e.g., admin, qa"
                 dir="ltr" 
               />
            </div>
            <div>
               <label htmlFor="password_input" className="block text-xs font-semibold text-[#1D1D1F] mb-1">Password</label>
               <input 
                 id="password_input"
                 type="password"
                 autoComplete="current-password"
                 disabled={loading}
                 value={password} 
                 onChange={e=>setPassword(e.target.value)} 
                 className="w-full bg-white border border-[#D2D2D7] rounded-lg px-3 py-2 text-[#1D1D1F] focus:outline-none focus:ring-1 focus:ring-[#0071E3] focus:border-[#0071E3] text-left font-mono text-sm leading-none disabled:opacity-50" 
                 placeholder="Enter your password"
                 dir="ltr" 
               />
            </div>
            <button 
              id="login_submit_btn"
              type="submit" 
              disabled={loading}
              className="w-full bg-[#0071E3] hover:bg-[#0025D2] text-white font-medium py-2 rounded-lg transition-colors mt-6 text-sm cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
            >
               {loading ? 'Verifying...' : 'Sign In'}
            </button>
         </form>
         {showDemoButton && (
           <div className="mt-5 pt-4 border-t border-[#E5E5EA] text-center">
             <button
               type="button"
               onClick={handleLocalDemoLogin}
               className="w-full bg-white border border-[#0071E3] text-[#0071E3] hover:bg-[#0071E3]/5 font-medium py-2 rounded-lg transition-colors text-sm cursor-pointer"
             >
               ورود آزمایشی (حالت لوکال — بدون دیتابیس)
             </button>
             <p className="mt-2 text-[10px] text-slate-400 leading-relaxed">
               داده‌ها فقط در همین مرورگر ذخیره می‌شوند. برای نسخهٔ نهایی، ورود عادی با پایگاه‌داده استفاده می‌شود.
             </p>
           </div>
         )}
      </div>
    </div>
  );
}
