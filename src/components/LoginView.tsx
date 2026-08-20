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
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Invalid username or password.');
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
      </div>
    </div>
  );
}
