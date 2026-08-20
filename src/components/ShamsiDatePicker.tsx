import React, { useState, useRef, useEffect } from 'react';
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

export const ShamsiDatePicker: React.FC<ShamsiDatePickerProps> = ({
  value,
  onChange,
  placeholder = 'انتخاب تاریخ...',
  disabled = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // استخراج سال، ماه و روز از مقدار فعلی
  const parts = value.split('/');
  const initialYear = parts.length === 3 ? parseInt(parts[0], 10) : 1403;
  const initialMonth = parts.length === 3 ? parseInt(parts[1], 10) : 1;
  
  const [currentYear, setCurrentYear] = useState<number>(initialYear);
  const [currentMonth, setCurrentMonth] = useState<number>(initialMonth); // ۱ تا ۱۲

  // مدیریت کلیک بیرون پاپ‌آپ
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

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
    const mm = currentMonth.toString().padStart(2, '0');
    const dd = day.toString().padStart(2, '0');
    onChange(`${currentYear}/${mm}/${dd}`);
    setIsOpen(false);
  };

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const startDayIndex = getStartDayOfWeek(currentYear, currentMonth);
  
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const emptyDaysArray = Array.from({ length: startDayIndex }, (_, i) => i);

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    setIsOpen(previous => !previous);
  };

  return (
    <div className="relative inline-block w-full" ref={containerRef} dir="rtl">
      {/* Input Field */}
      <div 
        className={`flex items-center justify-between w-full bg-white border border-slate-250 rounded-xl px-3 py-2 cursor-pointer
          ${disabled ? 'opacity-50 cursor-not-allowed bg-slate-50' : 'hover:border-indigo-300'} transition-all`}
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
          <CalendarIcon className="w-4 h-4 text-slate-400 shrink-0" />
          <div className="flex flex-col text-right min-w-0">
            <span className={`font-mono text-sm leading-none ${value ? 'text-slate-800' : 'text-slate-400'}`}>
              {value || placeholder}
            </span>
            {value && (
              <span className="text-[10px] text-slate-400 font-sans mt-1" dir="ltr" style={{ textAlign: 'right' }}>
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
            className="p-1 rounded-full text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Calendar Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ type: 'spring', bounce: 0.3, duration: 0.4 }}
            className="absolute top-full right-0 mt-2 z-50 bg-white border border-slate-250 shadow-[0_4px_24px_rgba(15,23,42,0.08)] rounded-2xl p-4 w-72 origin-top"
            role="dialog"
            aria-label="انتخاب تاریخ شمسی"
          >
            {/* Header (Moth & Year Setup) */}
            <div className="flex items-center justify-between mb-4">
              <button 
                type="button"
                aria-label="ماه بعد"
                onClick={handleNextMonth}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              
              <div className="flex flex-col items-center gap-1">
                <div className="flex items-center gap-1 font-mono">
                  {/* Month Dropdown Selector */}
                  <select
                    value={currentMonth}
                    onChange={(e) => setCurrentMonth(parseInt(e.target.value, 10))}
                    className="bg-slate-50 border border-slate-200 text-[11px] font-bold rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 cursor-pointer text-slate-700 font-sans shadow-sm"
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
                    onChange={(e) => setCurrentYear(parseInt(e.target.value, 10))}
                    className="bg-slate-50 border border-slate-200 text-[11px] font-bold rounded-lg px-1.5 py-1.5 focus:outline-none focus:border-indigo-500 cursor-pointer text-slate-700 shadow-sm"
                  >
                    {Array.from({ length: 41 }, (_, i) => 1380 + i).map((yr) => (
                      <option key={yr} value={yr}>
                        {yr}
                      </option>
                    ))}
                  </select>
                </div>
                
                {/* Gregorian Month/Year range equivalent */}
                <div className="text-[10px] text-slate-400 font-sans font-medium tracking-wide mt-0.5" dir="ltr">
                  {getGregorianHeaderLabel(currentYear, currentMonth)}
                </div>
              </div>
              
              <button 
                type="button"
                aria-label="ماه قبل"
                onClick={handlePrevMonth}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            {/* Weekdays */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {WEEK_DAYS.map(day => (
                <div key={day} className="text-center text-[10px] font-bold text-slate-400 pb-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-1">
              {emptyDaysArray.map(idx => (
                <div key={`empty-${idx}`} className="h-10 rounded-lg"></div>
              ))}
              
              {daysArray.map(day => {
                const mm = currentMonth.toString().padStart(2, '0');
                const dd = day.toString().padStart(2, '0');
                const thisDate = `${currentYear}/${mm}/${dd}`;
                const isSelected = value === thisDate;
                
                // محاسبه تاریخ میلادی معادل برای نشان دادن در تقویم
                let gregDay = '';
                try {
                  const { gd } = jalaali.toGregorian(currentYear, currentMonth, day);
                  gregDay = gd.toString();
                } catch (e) {}
                
                return (
                  <button
                    key={day}
                    type="button"
                    aria-label={`انتخاب تاریخ ${thisDate}`}
                    aria-pressed={isSelected}
                    onClick={() => handleDayClick(day)}
                    className={`
                      h-10 w-full flex flex-col items-center justify-center rounded-lg font-mono transition-all relative
                      ${isSelected 
                        ? 'bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/20' 
                        : 'text-slate-700 hover:bg-indigo-50 hover:text-indigo-600'
                      }
                    `}
                    title={`${thisDate} معادل ${getGregorianEquivalent(thisDate)}`}
                  >
                    <span className="text-xs leading-none font-bold">
                      {day.toString().padStart(2, '0')}
                    </span>
                    {gregDay && (
                      <span className={`text-[8px] leading-none mt-1 font-sans ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>
                        {gregDay}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            
            {/* Today Action & Legend */}
            <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400 font-sans px-1">
              <span>اعداد کوچک‌تر: روز میلادی</span>
              <button 
                type="button"
                onClick={() => {
                  const today = new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
                  // تبدیل اعداد فارسی به انگلیسی برای استاندارد پرایزما
                  const enToday = today.replace(/[۰-۹]/g, c => '0123456789'[c.charCodeAt(0) - 1776]);
                  onChange(enToday);
                  setIsOpen(false);
                }}
                className="font-bold text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                برو به امروز
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
