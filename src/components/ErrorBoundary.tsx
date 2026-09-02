import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui/button';

/**
 * Last line of defence for the whole app.
 *
 * React unmounts the entire tree when a render or an effect throws, which
 * leaves a blank white page — no message, nothing to report, and no way back
 * except a manual reload. In a GxP system a user cannot tell that apart from
 * "the data is gone", so an unhandled fault has to end in a readable message
 * rather than an empty screen.
 *
 * This catches the fault, shows what happened, and offers the two actions that
 * actually recover: reload, or clear the local cache and reload. The cache
 * button matters because the most likely cause is a full storage quota, and
 * that state survives a plain refresh. Nothing here touches the database — the
 * cache is only a local copy.
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

const CACHE_KEYS = ['app_db', 'app_materials', 'app_business_partners', 'app_audit_log', 'app_viewHistory'];

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled application error:', error, info.componentStack);
  }

  private clearCacheAndReload = () => {
    // Deliberately targeted: the session keys are left alone so the user is not
    // signed out on top of everything else.
    CACHE_KEYS.forEach(key => {
      try { localStorage.removeItem(key); } catch { /* ignore */ }
    });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4 font-sans">
        <div className="bg-card border border-border rounded-3xl p-8 max-w-lg w-full shadow-xl text-right space-y-5">
          <div className="flex items-center gap-3">
            <div className="bg-rose-500/10 border border-rose-500/20 p-2.5 rounded-2xl shrink-0">
              <AlertTriangle className="w-6 h-6 text-rose-600" />
            </div>
            <div>
              <h1 className="text-base font-black text-foreground">خطای غیرمنتظره در برنامه</h1>
              <p className="text-2xs text-muted-foreground mt-0.5">
                اطلاعات شما در پایگاه‌داده محفوظ است؛ این خطا فقط مربوط به نمایش برنامه است.
              </p>
            </div>
          </div>

          <div className="bg-muted border border-border rounded-xl p-3.5">
            <span className="text-2xs font-bold text-muted-foreground block mb-1">شرح فنی خطا:</span>
            <code className="text-2xs text-rose-700 dark:text-rose-400 font-mono break-all leading-relaxed">
              {this.state.error.message || String(this.state.error)}
            </code>
          </div>

          <p className="text-2xs text-muted-foreground leading-relaxed">
            اگر با بارگذاری مجدد برطرف نشد، حافظهٔ محلی مرورگر را پاک کنید. این کار هیچ داده‌ای را
            از پایگاه‌داده حذف نمی‌کند و شما را از حساب خارج نمی‌کند.
          </p>

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={this.clearCacheAndReload}
              className="text-xs font-bold text-muted-foreground"
            >
              پاک‌کردن حافظهٔ محلی و بارگذاری مجدد
            </Button>
            <Button
              type="button"
              onClick={() => window.location.reload()}
              className="text-xs font-bold"
            >
              بارگذاری مجدد
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
