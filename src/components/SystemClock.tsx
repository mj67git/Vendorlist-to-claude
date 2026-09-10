import React, { useEffect, useState } from 'react';

/**
 * The header's date and clock, and the state behind them.
 *
 * This was a `useState` on `App`. Every minute the tick re-rendered the entire
 * application — the sidebar, the header, the open view and everything under it
 * — to move one digit. Owning its own state, the re-render stops at this
 * element.
 *
 * The tick is scheduled onto the next minute boundary rather than a flat 60
 * seconds later, so the displayed minute never lags behind the real one.
 */

/**
 * `toLocaleDateString` with all four parts returns «۱۴۰۵ شهریور ۴, چهارشنبه» —
 * year first and the weekday stranded behind a comma. The parts are requested
 * separately and assembled instead, which also avoids stripping punctuation out
 * of a formatted string afterwards.
 */
function formatSystemDate(d: Date): string {
  const day = d.toLocaleDateString('fa-IR', { day: 'numeric' });
  const month = d.toLocaleDateString('fa-IR', { month: 'long' });
  const year = d.toLocaleDateString('fa-IR', { year: 'numeric' });
  const weekday = d.toLocaleDateString('fa-IR', { weekday: 'long' });
  return `${day} ${month} ${year} · ${weekday}`;
}

/**
 * Everything the clock shows, built in one place.
 *
 * The Gregorian date rides along because the people using this correspond with
 * suppliers abroad, where a Persian date means nothing. ISO order rather than a
 * localized form so it cannot be misread as day-first or month-first.
 */
function buildSystemTime(d: Date) {
  return {
    faDate: formatSystemDate(d),
    time: d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }),
    isoDate: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  };
}

export function SystemClock() {
  const [systemTime, setSystemTime] = useState(() => buildSystemTime(new Date()));

  useEffect(() => {
    let timer: number;
    const tick = () => {
      const d = new Date();
      setSystemTime(buildSystemTime(d));
      const msToNextMinute = 60_000 - (d.getSeconds() * 1000 + d.getMilliseconds());
      timer = window.setTimeout(tick, msToNextMinute);
    };
    tick();
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      className="hidden md:flex items-center gap-2.5 px-2.5 lg:px-3 py-1 bg-muted/60 border border-border/80 rounded-xl text-xs font-sans shrink-0"
      title={`تاریخ میلادی: ${systemTime.isoDate}`}
    >
      {/* Measured, not guessed: with the date in it the chip is wide enough to
          overflow the header at 820px — the width where the 272px sidebar
          leaves the bar about 548px and nothing here shrinks. So the clock
          alone appears from `md` and the date joins it at `lg`, where there is
          room for both. */}
      <span className="hidden lg:inline font-semibold text-foreground whitespace-nowrap">{systemTime.faDate}</span>
      <span className="hidden lg:inline text-border">|</span>
      <span className="font-mono font-bold text-primary tracking-wider leading-none" dir="ltr">{systemTime.time}</span>
    </div>
  );
}
