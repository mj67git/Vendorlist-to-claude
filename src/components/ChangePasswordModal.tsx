import React, { useState } from 'react';
import { Shield, Key, AlertCircle, CheckCircle, Eye, EyeOff, X } from 'lucide-react';
import { User } from '../types';

interface ChangePasswordModalProps {
  currentUser: User;
  isForceChange?: boolean; // If true, can't be closed, acts as initial setup screen
  onClose?: () => void;
  onPasswordChanged: (updatedUser: User) => void;
  onLogout?: () => void; // Provided during force change to allow logging out
}

export function ChangePasswordModal({
  currentUser,
  isForceChange = false,
  onClose,
  onPasswordChanged,
  onLogout
}: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('لطفاً تمامی فیلدها را تکمیل فرمایید.');
      return;
    }

    if (newPassword === '123' || newPassword === '123456') {
      setError('کلمه عبور جدید نمی‌تواند رمز پیش‌فرض باشد.');
      return;
    }

    if (newPassword.length < 6) {
      setError('کلمه عبور جدید باید حداقل ۶ کاراکتر باشد.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('کلمه عبور جدید و تکرار آن با یکدیگر مطابقت ندارند.');
      return;
    }

    setLoading(true);

    const token = localStorage.getItem('app_jwt_token');
    fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ currentPassword, newPassword })
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'خطا در تغییر کلمه عبور.');
        }
        return data;
      })
      .then((data) => {
        setSuccess(true);
        // Save the updated user object to local storage
        if (data.user) {
          localStorage.setItem('app_currentUser', JSON.stringify(data.user));
          setTimeout(() => {
            onPasswordChanged(data.user);
            if (onClose) onClose();
          }, 1500);
        } else {
          // Fallback if user is not in response
          const updatedUser = { ...currentUser, mustChangePassword: false };
          localStorage.setItem('app_currentUser', JSON.stringify(updatedUser));
          setTimeout(() => {
            onPasswordChanged(updatedUser);
            if (onClose) onClose();
          }, 1500);
        }
      })
      .catch((err) => {
        setError(err.message || 'ارتباط با سرور برقرار نشد.');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  // Render a full-page force reset screen
  if (isForceChange) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4 font-sans" dir="rtl">
        <div className="bg-white border border-slate-200 rounded-3xl p-8 max-w-md w-full shadow-[0_12px_40px_rgba(0,0,0,0.06)] fade-in">
          <div className="text-center mb-6">
            <div className="flex items-center justify-center mx-auto mb-4 bg-amber-500/10 border border-amber-500/20 w-16 h-16 rounded-2xl">
              <Shield className="w-8 h-8 text-amber-600 bounce-in" />
            </div>
            <h1 className="text-xl font-extrabold text-slate-800 mb-2 leading-snug">تغییر الزامی کلمه عبور اولیه</h1>
            <p className="text-slate-500 text-xs leading-relaxed">
              کاربر گرامی <span className="font-bold text-slate-700">{currentUser.name}</span>، جهت حفظ امنیت سامانه و رعایت استانداردهای کیفی دارو، تغییر رمز عبور پیش‌فرض در اولین ورود الزامی است.
            </p>
          </div>

          {success ? (
            <div className="py-8 text-center space-y-3">
              <div className="inline-flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-full mb-2">
                <CheckCircle className="w-10 h-10 text-emerald-500 bounce-in" />
              </div>
              <h4 className="text-base font-bold text-slate-800">کلمه عبور با موفقیت تغییر یافت</h4>
              <p className="text-xs text-slate-500">در حال ورود به سامانه، لطفاً شکیبا باشید...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div role="alert" aria-live="polite" className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-semibold leading-relaxed flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1">
                <label htmlFor="current_password_input" className="block text-xs font-bold text-slate-700">کلمه عبور فعلی (پیش‌فرض)</label>
                <div className="relative">
                  <input
                    id="current_password_input"
                    autoComplete="current-password"
                    type={showCurrent ? 'text' : 'password'}
                    required
                    disabled={loading}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-slate-800 focus:outline-none text-left font-mono text-sm leading-none disabled:opacity-50"
                    placeholder="کلمه عبور فعلی"
                  />
                  <button
                    type="button"
                    aria-label={showCurrent ? 'پنهان کردن کلمه عبور فعلی' : 'نمایش کلمه عبور فعلی'}
                    onClick={() => setShowCurrent(!showCurrent)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="new_password_input" className="block text-xs font-bold text-slate-700">کلمه عبور جدید</label>
                <div className="relative">
                  <input
                    id="new_password_input"
                    autoComplete="new-password"
                    type={showNew ? 'text' : 'password'}
                    required
                    disabled={loading}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-slate-800 focus:outline-none text-left font-mono text-sm leading-none disabled:opacity-50"
                    placeholder="رمز عبور حداقل ۶ کاراکتر"
                  />
                  <button
                    type="button"
                    aria-label={showNew ? 'پنهان کردن کلمه عبور جدید' : 'نمایش کلمه عبور جدید'}
                    onClick={() => setShowNew(!showNew)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor="confirm_password_input" className="block text-xs font-bold text-slate-700">تکرار کلمه عبور جدید</label>
                <div className="relative">
                  <input
                    id="confirm_password_input"
                    autoComplete="new-password"
                    type={showConfirm ? 'text' : 'password'}
                    required
                    disabled={loading}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-slate-800 focus:outline-none text-left font-mono text-sm leading-none disabled:opacity-50"
                    placeholder="تکرار رمز عبور جدید"
                  />
                  <button
                    type="button"
                    aria-label={showConfirm ? 'پنهان کردن تکرار کلمه عبور' : 'نمایش تکرار کلمه عبور'}
                    onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="pt-3 flex flex-col gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl transition-all shadow-md active:scale-[0.98] cursor-pointer text-xs disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? 'در حال ذخیره‌سازی...' : 'ثبت و ورود به سامانه'}
                </button>
                {onLogout && (
                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2.5 rounded-xl transition-all cursor-pointer text-xs flex items-center justify-center"
                  >
                    خروج از حساب کاربری
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Otherwise, render as a Standard Overlay Modal
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/40 backdrop-blur-md flex items-center justify-center p-4 font-sans" dir="rtl">
      <div
        className="bg-white border border-slate-200 rounded-3xl p-6 max-w-md w-full shadow-[0_20px_50px_rgba(0,0,0,0.15)] fade-in relative"
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-password-title"
      >
        <button
          type="button"
          aria-label="بستن پنجره تغییر رمز عبور"
          onClick={onClose}
          disabled={loading}
          className="absolute top-4 left-4 p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-50 border border-slate-200 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="bg-indigo-50 border border-indigo-100 p-2.5 rounded-2xl">
            <Key className="w-5 h-5 text-indigo-600" />
          </div>
          <div className="text-right">
            <h3 id="change-password-title" className="text-base font-extrabold text-slate-800">تغییر رمز عبور</h3>
            <p className="text-[11px] text-slate-400 mt-0.5">بروزرسانی اطلاعات امنیتی حساب کاربری</p>
          </div>
        </div>

        {success ? (
          <div className="py-6 text-center space-y-3">
            <div className="inline-flex items-center justify-center bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-full mb-2">
              <CheckCircle className="w-10 h-10 text-emerald-500 bounce-in" />
            </div>
            <h4 className="text-sm font-bold text-slate-800 font-sans">کلمه عبور با موفقیت بروزرسانی شد</h4>
            <p className="text-xs text-slate-500">کارت تبریک! این پنجره به زودی بسته می‌شود...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div role="alert" aria-live="polite" className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-semibold leading-relaxed flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="space-y-1 text-right">
              <label htmlFor="current_password_input" className="block text-xs font-bold text-slate-700">کلمه عبور فعلی</label>
              <div className="relative">
                <input
                  id="current_password_input"
                  autoComplete="current-password"
                  type={showCurrent ? 'text' : 'password'}
                  required
                  disabled={loading}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-slate-800 focus:outline-none text-left font-mono text-sm leading-none disabled:opacity-50"
                  placeholder="رمز عبور کنونی"
                />
                <button
                  type="button"
                  aria-label={showCurrent ? 'پنهان کردن کلمه عبور فعلی' : 'نمایش کلمه عبور فعلی'}
                  onClick={() => setShowCurrent(!showCurrent)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1 text-right">
              <label htmlFor="new_password_input" className="block text-xs font-bold text-slate-700">کلمه عبور جدید</label>
              <div className="relative">
                <input
                  id="new_password_input"
                  autoComplete="new-password"
                  type={showNew ? 'text' : 'password'}
                  required
                  disabled={loading}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-slate-800 focus:outline-none text-left font-mono text-sm leading-none disabled:opacity-50"
                  placeholder="حداقل ۶ کاراکتر"
                />
                <button
                  type="button"
                  aria-label={showNew ? 'پنهان کردن کلمه عبور جدید' : 'نمایش کلمه عبور جدید'}
                  onClick={() => setShowNew(!showNew)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1 text-right">
              <label htmlFor="confirm_password_input" className="block text-xs font-bold text-slate-700">تکرار کلمه عبور جدید</label>
              <div className="relative">
                <input
                  id="confirm_password_input"
                  autoComplete="new-password"
                  type={showConfirm ? 'text' : 'password'}
                  required
                  disabled={loading}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 rounded-xl pl-10 pr-4 py-2.5 text-slate-800 focus:outline-none text-left font-mono text-sm leading-none disabled:opacity-50"
                  placeholder="تکرار رمز عبور جدید"
                />
                <button
                  type="button"
                  aria-label={showConfirm ? 'پنهان کردن تکرار کلمه عبور' : 'نمایش تکرار کلمه عبور'}
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="pt-3 flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl transition-all shadow-md active:scale-[0.98] cursor-pointer text-xs disabled:opacity-50"
              >
                {loading ? 'در حال ثبت...' : 'ذخیره کلمه عبور'}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold rounded-xl transition-all cursor-pointer text-xs"
              >
                انصراف
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
