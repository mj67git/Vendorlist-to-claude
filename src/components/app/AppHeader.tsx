import React from 'react';
import { AlertTriangle, Bell, Calendar, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, Download, History, Menu, Moon, Shield, Sun, UserCog, X } from 'lucide-react';
import type { User, Vendor } from '../../types';
import { can } from '../../utils/permissions';
import { isLocalMode } from '../../services/authFetch';
import { formatDateTime } from '../../utils/session';
import type { RouteState } from '../../utils/navRoutes';
import type { ViewState } from '../../utils/navStack';
import type { LicenseExpiryStatus } from '../../utils/vendorUtils';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { EntityName } from '../EntityName';
import { SystemClock } from '../SystemClock';

/**
 * The bar across the top of every page: where you are, what needs attention,
 * and who you are signed in as.
 *
 * Four hundred lines of it lived at the bottom of `App.tsx`, which is why the
 * file could not be read in one sitting — the breadcrumb trail, the licence
 * expiry panel, the audit alert, the session countdown and the account menu are
 * five independent things that only share a row. They still share a row; they
 * no longer share a file with the router, the write paths and the navigation
 * stack.
 *
 * It owns no state. Every value and every setter belongs to `App`, which is
 * what makes the move behaviour-preserving: this is the same JSX, reading the
 * same variables, under different names for the same things.
 */
export interface AppHeaderProps {
  currentUser: User | null;
  vendors: Vendor[];
  /**
   * Sources whose licence is expiring or has expired, each with the check that
   * says which — computed once in `App` because the sidebar badge counts the
   * same list.
   */
  expiringVendors: Array<{ vendor: Vendor; check: LicenseExpiryStatus }>;
  /** Opens a source's page from the notification panel. */
  selectVendor: (vendor: Vendor) => void;
  /** The page currently on screen, for the «شما اینجا هستید» label. */
  currentViewState: ViewState;
  criticalAuditCount: number;
  breadcrumbTrail: Array<{ key: string; label: string; route: RouteState }>;
  goToCrumb: (route: RouteState) => void;
  getViewStateLabel: (state: ViewState) => string;
  viewHistory: ViewState[];
  goBack: () => void;
  navigate: (view: ViewState['view']) => void;
  onOpenSidebar: () => void;
  isDark: boolean;
  toggleTheme: () => void;
  showNotificationPanel: boolean;
  setShowNotificationPanel: React.Dispatch<React.SetStateAction<boolean>>;
  showUserMenu: boolean;
  setShowUserMenu: React.Dispatch<React.SetStateAction<boolean>>;
  setShowChangePasswordModal: React.Dispatch<React.SetStateAction<boolean>>;
  myActivity: Array<{ id: string; description?: string; action?: string }> | null;
  sessionLeftLabel: string | null;
  sessionExpiringSoon: boolean;
  myPermissionCount: number;
  myPermissionsCustom: boolean;
  roleInitials: (r?: string) => string;
  roleTitle: (r?: string) => string;
  handleLogout: () => void;
  /** Offered only in local mode, where there is no server holding the data. */
  handleDownloadBackup: () => void;
}

export function AppHeader({
  currentUser, vendors, expiringVendors, criticalAuditCount,
  breadcrumbTrail, goToCrumb, getViewStateLabel, viewHistory, goBack, navigate,
  selectVendor, currentViewState,
  onOpenSidebar, isDark, toggleTheme,
  showNotificationPanel, setShowNotificationPanel,
  showUserMenu, setShowUserMenu, setShowChangePasswordModal,
  myActivity, sessionLeftLabel, sessionExpiringSoon,
  myPermissionCount, myPermissionsCustom, roleInitials, roleTitle, handleLogout,
  handleDownloadBackup,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 bg-card/90 backdrop-blur-md border-b border-border/80 px-5 py-3 flex items-center justify-between shrink-0 print:hidden shadow-xs">
        {/* `min-w-0` on the group and a capped title: without it the row
            cannot shrink below its content, and on a deep page at ~900px
            the breadcrumbs pushed the header into horizontal overflow. */}
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden text-muted-foreground shrink-0"
            onClick={() => onOpenSidebar()}
          >
            <Menu />
          </Button>

          {/* Where the reader is.

              On the home page the whole right half of the bar was empty:
              the back button and the breadcrumbs only exist once the stack
              is deeper than one, so every control sat in the left corner
              and roughly 460px on the right — the first place a Persian
              reader looks — said nothing. The current page's name fills it
              on every screen, and the breadcrumbs continue the sentence
              when there is a path to show. */}
          {/* Navigation History & Back Handler */}
          <div className="flex items-center gap-2.5 min-w-0">
            {/* The page's name, and only where nothing else says it.

                Once the breadcrumbs appear (from `md`, with a path to show)
                the last crumb already names this page, and printing both
                made the two compete for the same strip — measured at 900px,
                the title truncated to «خرید …» while the first crumb was
                clipped to a single letter. So the heading yields to the
                trail exactly where the trail is shown — from `xl` — and
                stands alone everywhere else, including the whole tablet
                band where the trail does not fit. */}
            {/* `EntityName`, not a bare `truncate`: this heading carries a
                source's name on a detail page, and a name cut without a
                tooltip is exactly what rule 15 forbids — measured at 768px
                and 390px, where it does run out of room. */}
            <h1 className={`min-w-0 ${breadcrumbTrail.length > 1 ? 'xl:hidden' : ''}`}>
              <EntityName
                name={getViewStateLabel(currentViewState) || 'سامانهٔ ارزیابی تأمین‌کنندگان'}
                lines={1}
                className="text-sm font-black text-foreground max-w-[180px] sm:max-w-[240px] lg:max-w-[320px]"
              />
            </h1>
            {viewHistory.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                onClick={goBack}
                className="h-8 gap-1.5 text-xs font-bold text-foreground bg-background hover:bg-accent border-border shrink-0"
                title={`برگشت به ${getViewStateLabel(viewHistory[viewHistory.length - 2]) || 'مرحله قبل'}`}
              >
                <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                <span>برگشت</span>
              </Button>
            )}

            {/* Breadcrumb trail — the path to this page, and a way back up
                to any level of it. Built from the address (see
                `breadcrumbTrail`), so it is the same trail however the
                reader arrived and never claims that one module sits inside
                another.

                Shown from `xl`, and the page's own name takes its place
                below that. Measured, not guessed: with the sidebar and the
                action cluster taking their share, the strip left for the
                trail is about 185px at 1024 and 441px at 1280, while a
                three-crumb path («صفحه اصلی › خرید خارجی › نام سورس») needs
                roughly 250px. Rendering it at `md` — where it was until now
                — meant the row overflowed and the crumb that got cut was
                the last one, the page you are on, with no ellipsis and no
                tooltip. A heading that fits beats a path that does not. */}
            {breadcrumbTrail.length > 1 && (
              <nav aria-label="مسیر ناوبری" className="hidden xl:flex items-center gap-1 min-w-0 text-xs">
                {(() => {
                  /* Collapse the middle, never the ends.
                     The trail is at most four levels now, but a long source
                     name can still outgrow the row — and the crumb that used
                     to lose was the last one, the page you are actually on,
                     cut without an ellipsis or a tooltip. The first crumb
                     and the last two always render; anything between them
                     becomes one «…» that names what it hides. */
                  // Four is the deepest real path (home › module › record
                  // › its edit page), so the whole trail normally shows;
                  // the collapse is what keeps a longer one honest rather
                  // than letting it cut the current page off the end.
                  const MAX_VISIBLE = 4;
                  const collapse = breadcrumbTrail.length > MAX_VISIBLE;
                  const hidden = collapse ? breadcrumbTrail.slice(1, -2) : [];
                  const shown = collapse
                    ? [breadcrumbTrail[0], null, ...breadcrumbTrail.slice(-2)]
                    : breadcrumbTrail;

                  return shown.map((crumb, idx) => (
                    <React.Fragment key={crumb ? crumb.key : 'collapsed'}>
                      {idx > 0 && <ChevronLeft className="w-3 h-3 text-muted-foreground/50 shrink-0" />}
                      {crumb === null ? (
                        <span
                          className="font-semibold text-muted-foreground shrink-0 px-0.5 cursor-help"
                          title={`سطوح میانی: ${hidden.map(h => h!.label).join(' › ')}`}
                        >
                          …
                        </span>
                      ) : idx === shown.length - 1 ? (
                        /* The page itself: it truncates with a tooltip
                           rather than being cut silently (rule 15). */
                        <EntityName
                          name={crumb.label}
                          lines={1}
                          aria-current="page"
                          className="font-bold text-foreground max-w-[120px] lg:max-w-[220px]"
                        />
                      ) : (
                        <button
                          onClick={() => goToCrumb(crumb.route)}
                          // `shrink-0`, because these are short fixed labels
                          // («صفحه اصلی», «خرید خارجی») and the flex row was
                          // squeezing them below their own width — at 13.5px
                          // even those two clipped, and a breadcrumb whose
                          // own labels are cut tells the reader nothing
                          // about where they are. The squeeze belongs on the
                          // last crumb, which carries a tooltip when it
                          // truncates (rule 15).
                          className="font-semibold text-muted-foreground hover:text-primary hover:underline truncate max-w-[160px] shrink-0 transition-colors cursor-pointer"
                          title={`رفتن به ${crumb.label}`}
                        >
                          {crumb.label}
                        </button>
                      )}
                    </React.Fragment>
                  ));
                })()}
              </nav>
            )}
          </div>

        </div>
    
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Dark / light theme toggle */}
          <Button
            variant="outline"
            size="icon"
            onClick={toggleTheme}
            className="text-muted-foreground"
            title={isDark ? 'روشن کردن حالت روز' : 'فعال‌کردن حالت شب'}
            aria-label="تغییر حالت روز/شب"
          >
            {isDark ? <Sun /> : <Moon />}
          </Button>

          {/* Notification Center for License Expiry */}
          <div className="relative">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowNotificationPanel(!showNotificationPanel)}
              aria-haspopup="dialog"
              aria-expanded={showNotificationPanel}
              aria-label={expiringVendors.length > 0
                ? `مرکز اعلان‌ها، ${expiringVendors.length} هشدار انقضای مجوز`
                : 'مرکز اعلان‌های سیستم'}
              className={`relative ${
                expiringVendors.length > 0
                  ? 'bg-amber-50 hover:bg-amber-100/80 border-amber-300 text-amber-800 hover:text-amber-800 dark:bg-amber-950/40 dark:border-amber-700/50 dark:text-amber-300 shadow-xs'
                  : 'text-muted-foreground'
              }`}
              title={expiringVendors.length > 0 ? `${expiringVendors.length} مورد هشدار انقضای مجوز` : 'مرکز اعلان‌های سیستم'}
            >
              <Bell className="w-4 h-4" />
              {expiringVendors.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 px-1 min-w-[18px] h-[18px] bg-rose-600 text-white text-2xs font-bold font-mono rounded-full flex items-center justify-center shadow-xs">
                  {expiringVendors.length}
                </span>
              )}
            </Button>

            {/* Dropdown Popover */}
            {showNotificationPanel && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowNotificationPanel(false)} 
                />
                <div className="absolute left-0 right-auto mt-2 w-[calc(100vw-2rem)] sm:w-96 max-w-sm sm:max-w-md bg-popover border border-border rounded-2xl shadow-xl z-50 overflow-hidden fade-in text-right font-sans">
                  <div className="p-3.5 bg-muted/60 border-b border-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span className="font-bold text-xs text-foreground">مرکز اعلان‌های انقضای مجوز (IRC / IVC)</span>
                    </div>
                    <Badge variant="warning" className="text-2xs font-mono font-bold">
                      {expiringVendors.length} مورد
                    </Badge>
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-border p-1">
                    {expiringVendors.length === 0 ? (
                      <div className="p-6 text-center text-muted-foreground text-xs">
                        <CheckCircle className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                        <div className="font-bold text-foreground">همه مجوزها معتبر هستند</div>
                        <div className="text-2xs mt-1 text-muted-foreground">هیچ مجوزی در آستانه انقضا (کمتر از ۲ ماه) قرار ندارد.</div>
                      </div>
                    ) : (
                      expiringVendors.map(({ vendor, check }) => (
                        <div
                          key={vendor.id}
                          onClick={() => {
                            selectVendor(vendor);
                            setShowNotificationPanel(false);
                          }}
                          className="p-3 hover:bg-amber-50/50 dark:hover:bg-amber-950/20 cursor-pointer transition-colors rounded-xl space-y-1.5 group"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-bold text-xs text-foreground group-hover:text-amber-800 dark:group-hover:text-amber-300 truncate">
                              {vendor.material || vendor.name}
                            </div>
                            {check.status === 'expired' ? (
                              <Badge variant="destructive" className="text-2xs px-1.5 py-0">
                                منقضی
                              </Badge>
                            ) : (
                              <Badge variant="warning" className="text-2xs px-1.5 py-0">
                                {check.daysLeft} روز مانده
                              </Badge>
                            )}
                          </div>
                          <div className="text-2xs text-muted-foreground truncate">
                            تامین‌کننده: {vendor.name} {vendor.irc ? `(IRC: ${vendor.irc})` : ''}
                          </div>
                          <div className="text-2xs text-muted-foreground flex items-center justify-between pt-1">
                            <span>تاریخ انقضا: <strong className="font-mono text-foreground">{vendor.ircExpiryDate}</strong></span>
                            <span className="text-primary font-bold text-2xs group-hover:underline">مشاهده سورس ←</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Backing up the database is an administrator's occasional
              errand, and it used to sit in the bar with the same weight as
              the notification bell and the account box — controls that are
              there on every screen for everyone. It moved into the account
              menu, beside the other things done once in a while.

              Note its gate is a deliberate house rule, not a security
              boundary: the file is built in the browser from `vendors`, which
              `GET /api/vendors` already serves to every signed-in user. A
              server permission cannot be added for it without inventing one
              no endpoint enforces — the mistake `archive.read` was deleted
              for. */}

          {/* Live clock, in the top-left beside the account box.

              Two facts, not three. It used to print the Jalali date, the
              time and the Gregorian date side by side and stood 276px wide
              — the largest single item in a row where nothing shrinks,
              which is why it had to be hidden below `lg` to stop the whole
              cluster being pushed off the left edge. The Gregorian date is
              for foreign correspondence, which is a "look it up" fact, so
              it moved into the chip's tooltip and the chip came back at
              `md`. */}
          <SystemClock />

          {/* This used to be a permanently green, permanently pulsing
              "سیستم فعال" chip. A status that cannot change is not status,
              it is decoration. The one thing here that genuinely varies is
              whether the session is talking to the database at all, so the
              chip now appears only when it is not. */}
          {isLocalMode() && (
            <div className="hidden lg:flex bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 rounded-full items-center gap-1.5" title="داده‌ها فقط در همین مرورگر ذخیره می‌شوند">
              <AlertTriangle className="w-3 h-3 text-amber-600 dark:text-amber-400" />
              <span className="text-2xs font-bold text-amber-700 dark:text-amber-300">حالت لوکال (بدون پایگاه‌داده)</span>
            </div>
          )}

          {/* User menu (moved from the sidebar) */}
          {currentUser && (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(v => !v)}
                aria-haspopup="menu"
                aria-expanded={showUserMenu}
                aria-label={`منوی حساب کاربری ${currentUser.name || currentUser.username}`}
                className="flex items-center gap-2 pr-1 pl-2 py-1 rounded-xl border border-border bg-background hover:bg-accent transition-colors cursor-pointer"
                title={currentUser.name || currentUser.username}
              >
                <Avatar className="h-7 w-7 border border-border">
                  <AvatarFallback className="text-2xs font-extrabold bg-primary/10 text-primary">{roleInitials(currentUser.role)}</AvatarFallback>
                </Avatar>
                <span className="hidden sm:flex flex-col text-right leading-tight max-w-[120px]">
                  <span className="text-2xs font-bold text-foreground truncate">{currentUser.name || currentUser.username}</span>
                  <span className="text-2xs text-muted-foreground truncate">{roleTitle(currentUser.role)}</span>
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute left-0 right-auto mt-2 w-72 bg-popover border border-border rounded-2xl shadow-xl z-50 overflow-hidden fade-in text-right">
                    <div className="p-3.5 bg-muted/50 border-b border-border flex items-center gap-2.5">
                      <Avatar className="h-9 w-9 border border-border">
                        <AvatarFallback className="text-2xs font-extrabold bg-primary/10 text-primary">{roleInitials(currentUser.role)}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-bold text-foreground truncate">{currentUser.name || currentUser.username}</span>
                        <span className="text-2xs font-semibold text-muted-foreground truncate">{roleTitle(currentUser.role)}</span>
                      </div>
                    </div>
                    {/* Session facts: when they were last here, how long this
                        session has left, and what they can do. */}
                    <div className="px-3.5 py-2.5 border-b border-border space-y-1.5 text-2xs text-muted-foreground">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <History className="w-3 h-3" />
                          ورود قبلی
                        </span>
                        <span className="font-semibold text-foreground">
                          {formatDateTime(currentUser.previousLoginAt) || 'اولین ورود'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <Calendar className="w-3 h-3" />
                          اعتبار نشست
                        </span>
                        <span className={`font-semibold ${sessionExpiringSoon ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                          {sessionLeftLabel || '—'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <Shield className="w-3 h-3" />
                          سطح دسترسی
                        </span>
                        <span className="font-semibold text-foreground">
                          {myPermissionCount} مورد{myPermissionsCustom ? ' (سفارشی)' : ''}
                        </span>
                      </div>
                    </div>

                    {/* My recent activity, straight from the audit trail. */}
                    <div className="px-3.5 py-2.5 border-b border-border">
                      <span className="text-2xs font-bold text-muted-foreground block mb-1.5">فعالیت اخیر من</span>
                      {myActivity === null ? (
                        <span className="text-2xs text-muted-foreground italic">در حال بارگذاری...</span>
                      ) : myActivity.length === 0 ? (
                        <span className="text-2xs text-muted-foreground italic">فعالیتی ثبت نشده است.</span>
                      ) : (
                        <ul className="space-y-1">
                          {myActivity.map(a => (
                            <li key={a.id} className="flex items-start gap-1.5 text-2xs leading-snug">
                              <span className="w-1 h-1 rounded-full bg-cyan-500 mt-1.5 shrink-0" />
                              <span className="text-muted-foreground truncate" title={a.description}>
                                {a.description || a.action}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    {/* The theme switch is not repeated here.

                        It had a permanent icon button in the bar and a row
                        in this menu: one setting, two controls, and the two
                        never agreed about which state they were showing.
                        The bar keeps it, because it is used several times a
                        day; the menu keeps the things that are not. */}
                    <div className="p-1.5">
                      {can(currentUser, 'users.manage') && (
                        <button
                          onClick={() => { setShowUserMenu(false); handleDownloadBackup(); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-foreground hover:bg-accent transition-colors text-right"
                          title="دانلود پشتیبان کامل پایگاه‌داده (JSON)"
                        >
                          <Download className="w-4 h-4 text-primary" />
                          پشتیبان‌گیری کامل
                        </button>
                      )}
                      {can(currentUser, 'users.manage') && (
                        <button
                          onClick={() => { setShowUserMenu(false); navigate('users'); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-foreground hover:bg-accent transition-colors text-right"
                        >
                          <UserCog className="w-4 h-4 text-primary" />
                          مدیریت کاربران
                        </button>
                      )}
                      <button
                        onClick={() => { setShowUserMenu(false); setShowChangePasswordModal(true); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-foreground hover:bg-accent transition-colors text-right"
                      >
                        <Shield className="w-4 h-4 text-primary" />
                        تغییر کلمه عبور
                      </button>
                      <button
                        onClick={() => { setShowUserMenu(false); handleLogout(); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors text-right"
                      >
                        <X className="w-4 h-4" />
                        خروج از حساب
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>
  );
}
