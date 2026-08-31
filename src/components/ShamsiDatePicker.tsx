import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar as CalendarIcon, X, ChevronRight, ChevronLeft } from 'lucide-react';
import jalaali from 'jalaali-js';

const getGregorianEquivalent = (jalaliStr: string) => {
  if (!jalaliStr) return '';
  const parts = jalaliStr.split('/');
  if (parts.length !== 3) return '';
  const jy = parseInt(parts[0], 10);
  const jm = parseInt(parts[1], 10);
  const jd = parseInt(parts[2], 10);
  if (isNaN(jy) || isNaN(jm) || isNaN(jd)) return '';
  try {
    const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    const mm = gm.toString().padStart(2, '0');
    const dd = gd.toString().padStart(2, '0');
    return `${gy}/${mm}/${dd} (${months[gm - 1]})`;
  } catch (e) {
    return '';
  }
};

const getGregorianHeaderLabel = (jy: number, jm: number) => {
  try {
    const gStart = jalaali.toGregorian(jy, jm, 1);
    const lastDay = jalaali.jalaaliMonthLength(jy, jm);
    const gEnd = jalaali.toGregorian(jy, jm, lastDay);

    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    if (gStart.gm === gEnd.gm) {
      return `${months[gStart.gm - 1]} ${gStart.gy}`;
    } else {
      const yearStr = gStart.gy === gEnd.gy ? `${gStart.gy}` : `${gStart.gy}/${gEnd.gy.toString().slice(-2)}`;
      return `${months[gStart.gm - 1]} / ${months[gEnd.gm - 1]} ${yearStr}`;
    }
  } catch (e) {
    return '';
  }
};

interface ShamsiDatePickerProps {
  value: string; // YYYY/MM/DD
  onChange: (date: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

const MONTH_NAMES = [
  'فروردین', 'اردیبهشت', 'خرداد',
  'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر',
  'دی', 'بهمن', 'اسفند'
];

const WEEK_DAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

/** Popover box, used both for measuring before paint and for the panel's own width. */
const PANEL_WIDTH = 288; // w-72
const PANEL_MAX_HEIGHT = 380;
const VIEWPORT_MARGIN = 8;

const getDaysInMonth = (year: number, month: number) => {
  return jalaali.jalaaliMonthLength(year, month);
};

// پیدا کردن روز شروع ماه
const getStartDayOfWeek = (year: number, month: number) => {
  const { gy, gm, gd } = jalaali.toGregorian(year, month, 1);
  const jsDay = new Date(gy, gm - 1, gd).getDay();
  // تبدیل خروجی getDay جاوااسکریپت (یکشنبه ۰، ... شنبه ۶) به ایندکس‌های ما (شنبه ۰، ... جمعه ۶)
  return jsDay === 6 ? 0 : jsDay + 1;
};

const pad2 = (n: number) => n.toString().padStart(2, '0');
const formatJalali = (jy: number, jm: number, jd: number) => `${jy}/${pad2(jm)}/${pad2(jd)}`;

export const ShamsiDatePicker: React.FC<ShamsiDatePickerProps> = ({
  value,
  onChange,
  placeholder = 'انتخاب تاریخ...',
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // استخراج سال، ماه و روز از مقدار فعلی
  // An empty picker used to open on Farvardin 1403 — a fixed date in the past,
  // so every "pick a date" started with two years of paging. Open on today.
  const today = jalaali.toJalaali(new Date());
  const parts = value.split('/');
  const hasValue = parts.length === 3 && !isNaN(parseInt(parts[0], 10));
  const valueYear = hasValue ? parseInt(parts[0], 10) : today.jy;
  const valueMonth = hasValue ? parseInt(parts[1], 10) : today.jm;

  const [currentYear, setCurrentYear] = useState<number>(valueYear);
  const [currentMonth, setCurrentMonth] = useState<number>(valueMonth); // ۱ تا ۱۲

  /**
   * The calendar used to read `value` only on mount, so a reset from the parent
   * (clearing the form, "go to today") left the grid parked on the old month.
   */
  useEffect(() => {
    if (isOpen) return; // don't yank the month out from under someone paging through it
    setCurrentYear(valueYear);
    setCurrentMonth(valueMonth);
  }, [valueYear, valueMonth, isOpen]);

  /**
   * The popover is portalled to <body> and positioned from the trigger's rect.
   *
   * As a plain `absolute top-full` child it was clipped by any ancestor with an
   * overflow (the lab-records table wraps it in `overflow-x-auto`, and FormModal's
   * panel is `overflow-hidden`), and it never flipped up, so near the bottom of
   * the viewport the day grid fell off screen. Same reasoning as rule 8 in
   * CLAUDE.md: leave the page's stacking/overflow context entirely.
   */
  const [coords, setCoords] = useState<{ top: number; left: number; placement: 'bottom' | 'top' } | null>(null);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const panelHeight = panelRef.current?.offsetHeight || PANEL_MAX_HEIGHT;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placement: 'bottom' | 'top' =
      spaceBelow < panelHeight + VIEWPORT_MARGIN && spaceAbove > spaceBelow ? 'top' : 'bottom';

    const top = placement === 'bottom' ? rect.bottom + VIEWPORT_MARGIN : rect.top - panelHeight - VIEWPORT_MARGIN;
    // The panel is right-aligned with the trigger (RTL), then clamped into view.
    const rawLeft = rect.right - PANEL_WIDTH;
    const maxLeft = window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rawLeft, maxLeft));

    setCoords({
      top: Math.max(VIEWPORT_MARGIN, Math.min(top, window.innerHeight - panelHeight - VIEWPORT_MARGIN)),
      left,
      placement,
    });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }
    updatePosition();
  }, [isOpen, updatePosition]);

  // Reposition once the panel has a real height, and follow scroll/resize.
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    const onScrollOrResize = () => updatePosition();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [isOpen, currentYear, currentMonth, updatePosition]);

  const closeAndRefocus = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  // مدیریت کلیک بیرون پاپ‌آپ (پنل در portal است، پس هر دو ref بررسی می‌شوند)
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setIsOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeAndRefocus();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey, true);
    };
  }, [isOpen, closeAndRefocus]);

  const handleNextMonth = () => {
    if (currentMonth === 12) {
      setCurrentMonth(1);
      setCurrentYear(prev => prev + 1);
    } else {
      setCurrentMonth(prev => prev + 1);
    }
  };

  const handlePrevMonth = () => {
    if (currentMonth === 1) {
      setCurrentMonth(12);
      setCurrentYear(prev => prev - 1);
    } else {
      setCurrentMonth(prev => prev - 1);
    }
  };

  const handleDayClick = (day: number) => {
    onChange(formatJalali(currentYear, currentMonth, day));
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const startDayIndex = getStartDayOfWeek(currentYear, currentMonth);

  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const emptyDaysArray = Array.from({ length: startDayIndex }, (_, i) => i);

  const todayKey = formatJalali(today.jy, today.jm, today.jd);

  /**
   * Years run relative to today, not from a hardcoded 1380–1420 window: the same
   * control picks IRC expiry dates (forward) and lab test dates (backward).
   */
  const yearOptions = React.useMemo(() => {
    const from = Math.min(today.jy - 20, valueYear);
    const to = Math.max(today.jy + 15, valueYear);
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  }, [today.jy, valueYear]);

  const focusDay = (day: number) => {
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)?.focus();
  };

  /** پیمایش روزها با کلیدهای جهت (در RTL، چپ = روز بعد). */
  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const active = document.activeElement as HTMLElement | null;
    const currentDay = parseInt(active?.dataset?.day || '', 10);
    if (isNaN(currentDay)) return;

    const deltas: Record<string, number> = {
      ArrowLeft: 1,
      ArrowRight: -1,
      ArrowDown: 7,
      ArrowUp: -7,
    };
    let next: number | null = null;
    if (event.key in deltas) next = currentDay + deltas[event.key];
    else if (event.key === 'Home') next = 1;
    else if (event.key === 'End') next = daysInMonth;
    if (next === null) return;

    event.preventDefault();
    if (next < 1) {
      const prevMonth = currentMonth === 1 ? 12 : currentMonth - 1;
      const prevYear = currentMonth === 1 ? currentYear - 1 : currentYear;
      handlePrevMonth();
      requestAnimationFrame(() => focusDay(getDaysInMonth(prevYear, prevMonth) + next!));
      return;
    }
    if (next > daysInMonth) {
      const overflow = next - daysInMonth;
      handleNextMonth();
      requestAnimationFrame(() => focusDay(overflow));
      return;
    }
    focusDay(next);
  };

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setIsOpen(previous => !previous);
      return;
    }
    if (event.key === 'ArrowDown' && !isOpen) {
      event.preventDefault();
      setIsOpen(true);
    }
  };

  // وقتی پاپ‌اور باز می‌شود، فوکوس روی روز انتخاب‌شده (یا امروز، یا روز اول) می‌رود.
  useEffect(() => {
    if (!isOpen) return;
    const preferred = hasValue && parseInt(parts[0], 10) === currentYear && parseInt(parts[1], 10) === currentMonth
      ? parseInt(parts[2], 10)
      : today.jy === currentYear && today.jm === currentMonth
        ? today.jd
        : 1;
    const id = requestAnimationFrame(() => focusDay(preferred));
    return () => cancelAnimationFrame(id);
    // فقط هنگام باز شدن؛ تعویض ماه فوکوس خودش را در handleGridKeyDown مدیریت می‌کند
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const panel = (
    <AnimatePresence>
      {isOpen && coords && (
        <motion.div
          ref={panelRef}
          dir="rtl"
          initial={{ opacity: 0, scale: 0.95, y: coords.placement === 'bottom' ? -4 : 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: coords.placement === 'bottom' ? -4 : 4 }}
          transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
          style={{ top: coords.top, left: coords.left, width: PANEL_WIDTH }}
          className={`fixed z-[120] bg-popover text-popover-foreground border border-border shadow-[0_8px_32px_rgba(15,23,42,0.18)] rounded-2xl p-4 ${
            coords.placement === 'bottom' ? 'origin-top' : 'origin-bottom'
          }`}
          role="dialog"
          aria-modal="false"
          aria-label="انتخاب تاریخ شمسی"
        >
            {/* Header (Month & Year Setup) */}
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                aria-label="ماه بعد"
                onClick={handleNextMonth}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1 font-mono">
                  {/* Month Dropdown Selector */}
                  <select
                    value={currentMonth}
                    aria-label="ماه"
                    onChange={(e) => setCurrentMonth(parseInt(e.target.value, 10))}
                    className="bg-muted border border-border text-[11px] font-bold rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer text-foreground font-sans shadow-sm"
                  >
                    {MONTH_NAMES.map((name, index) => (
                      <option key={index + 1} value={index + 1}>
                        {name}
                      </option>
                    ))}
                  </select>

                  {/* Year Dropdown Selector */}
                  <select
                    value={currentYear}
                    aria-label="سال"
                    onChange={(e) => setCurrentYear(parseInt(e.target.value, 10))}
                    className="bg-muted border border-border text-[11px] font-bold rounded-lg px-1.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer text-foreground shadow-sm"
                  >
                    {yearOptions.map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Gregorian Month/Year range equivalent */}
                <div className="text-[10px] text-muted-foreground font-sans font-medium tracking-wide mt-0.5" dir="ltr">
                  {getGregorianHeaderLabel(currentYear, currentMonth)}
                </div>
              </div>

              <button
                type="button"
                aria-label="ماه قبل"
                onClick={handlePrevMonth}
                className="p-1.5 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            {/* Weekdays */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {WEEK_DAYS.map(day => (
                <div key={day} className="text-center text-[10px] font-bold text-muted-foreground pb-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-1" ref={gridRef} onKeyDown={handleGridKeyDown}>
              {emptyDaysArray.map(idx => (
                <div key={`empty-${idx}`} className="h-9 rounded-lg"></div>
              ))}

              {daysArray.map(day => {
                const thisDate = formatJalali(currentYear, currentMonth, day);
                const isSelected = value === thisDate;
                const isToday = thisDate === todayKey;

                return (
                  <button
                    key={day}
                    type="button"
                    data-day={day}
                    aria-label={`انتخاب تاریخ ${thisDate}`}
                    aria-pressed={isSelected}
                    aria-current={isToday ? 'date' : undefined}
                    onClick={() => handleDayClick(day)}
                    className={`
                      h-9 w-full flex items-center justify-center rounded-lg font-mono text-xs font-bold transition-all relative
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
                      ${isSelected
                        ? 'bg-primary text-primary-foreground shadow-md'
                        : isToday
                          ? 'text-primary ring-1 ring-primary/50 hover:bg-accent'
                          : 'text-foreground hover:bg-accent'
                      }
                    `}
                    title={`${thisDate} معادل ${getGregorianEquivalent(thisDate)}`}
                  >
                    {pad2(day)}
                  </button>
                );
              })}
            </div>

            {/* Today Action */}
            <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-end text-[10px] font-sans px-1">
              <button
                type="button"
                onClick={() => {
                  // Same conversion path as everywhere else in this file; the old
                  // Intl('fa-IR') + Persian-digit substitution depended on browser locale data.
                  const now = jalaali.toJalaali(new Date());
                  onChange(formatJalali(now.jy, now.jm, now.jd));
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
                className="font-bold text-primary hover:text-primary-hover transition-colors"
              >
                برو به امروز
              </button>
            </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className="relative inline-block w-full" ref={containerRef} dir="rtl">
      {/* Input Field */}
      <div
        ref={triggerRef}
        className={`flex items-center justify-between w-full bg-card border border-border rounded-xl px-3 py-2 cursor-pointer
          focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
          ${disabled ? 'opacity-50 cursor-not-allowed bg-muted' : 'hover:border-border-hover'} transition-all`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={value ? `تاریخ انتخاب‌شده ${value}` : placeholder}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => !disabled && setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <CalendarIcon className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="flex flex-col text-right min-w-0">
            <span className={`font-mono text-sm leading-none ${value ? 'text-foreground' : 'text-muted-foreground'}`}>
              {value || placeholder}
            </span>
            {value && (
              <span className="text-[10px] text-muted-foreground font-sans mt-1" dir="ltr" style={{ textAlign: 'right' }}>
                {getGregorianEquivalent(value)}
              </span>
            )}
          </div>
        </div>

        {value && !disabled && (
          <button
            type="button"
            aria-label="پاک کردن تاریخ"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="p-1 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {typeof document !== 'undefined' && createPortal(panel, document.body)}
    </div>
  );
};
