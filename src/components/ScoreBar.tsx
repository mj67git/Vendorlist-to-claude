import React from 'react';

export function getScoreColorClass(score: number | null, isBar = false) {
  if (score === null) return isBar ? 'bg-slate-200' : 'text-slate-400';
  if (score >= 80) return isBar ? 'bg-emerald-600' : 'text-emerald-600';
  if (score >= 60) return isBar ? 'bg-[#0071E3]' : 'text-[#0071E3]';
  if (score >= 40) return isBar ? 'bg-amber-600' : 'text-amber-600';
  return isBar ? 'bg-red-600' : 'text-red-600';
}

export function getSRIColorClass(sri: number | null | undefined, isBar = false) {
  if (sri === null || sri === undefined) return isBar ? 'bg-slate-200' : 'text-slate-400';
  if (sri >= 76) return isBar ? 'bg-red-600' : 'text-red-600';
  if (sri >= 26) return isBar ? 'bg-amber-500' : 'text-amber-500';
  return isBar ? 'bg-emerald-600' : 'text-emerald-600';
}

export function getScoreColorConfig(overall: number | null, fallbackStatus: string) {
  if (fallbackStatus === 'rejected') {
    return {
      border: 'border-red-500 text-red-600',
      heroBorder: 'border-red-600/25 shadow-[0_4px_24px_rgba(220,38,38,0.12),0_1px_4px_rgba(15,23,42,0.06)]'
    };
  }
  if (overall === null) {
    if (fallbackStatus === 'approved') {
      return {
        border: 'border-emerald-500 text-emerald-600',
        heroBorder: 'border-emerald-600/25 shadow-[0_4px_24px_rgba(5,150,105,0.12),0_1px_4px_rgba(15,23,42,0.06)]'
      };
    }
    if (fallbackStatus === 'conditional') {
      return {
        border: 'border-amber-500 text-amber-600',
        heroBorder: 'border-amber-600/25 shadow-[0_4px_24px_rgba(217,119,6,0.12),0_1px_4px_rgba(15,23,42,0.06)]'
      };
    }
    return {
      border: 'border-cyan-500 text-cyan-600',
      heroBorder: 'border-cyan-600/25 shadow-[0_4px_24px_rgba(8,145,178,0.12),0_1px_4px_rgba(15,23,42,0.06)]'
    };
  }
  
  if (overall >= 80) {
    return {
      border: 'border-emerald-500 text-emerald-600',
      heroBorder: 'border-emerald-600/25 shadow-[0_4px_24px_rgba(5,150,105,0.12),0_1px_4px_rgba(15,23,42,0.06)]'
    };
  }
  if (overall >= 60) {
    return {
      border: 'border-[#0071E3] text-[#0071E3]',
      heroBorder: 'border-[#0071E3]/25 shadow-[0_4px_24px_rgba(0,113,227,0.12),0_1px_4px_rgba(15,23,42,0.06)]'
    };
  }
  if (overall >= 40) {
    return {
      border: 'border-amber-500 text-amber-600',
      heroBorder: 'border-amber-600/25 shadow-[0_4px_42px_rgba(217,119,6,0.12),0_1px_4px_rgba(15,23,42,0.06)]'
    };
  }
  return {
    border: 'border-red-500 text-red-600',
    heroBorder: 'border-red-600/25 shadow-[0_4px_24px_rgba(220,38,38,0.12),0_1px_4px_rgba(15,23,42,0.06)]'
  };
}

interface ScoreBarProps {
  label: string;
  value: number;
  max?: number;
}

export function ScoreBar({ label, value, max = 100 }: ScoreBarProps) {
  const percentage = (value / max) * 100;
  return (
    <div className="flex flex-col gap-1.5 mb-3">
      <div className="flex justify-between items-center text-xs">
        <span className="text-slate-600">{label}</span>
        <span className={`font-bold font-mono ${getScoreColorClass(percentage)}`}>{value} / {max}</span>
      </div>
      <div className="w-full h-px bg-slate-900/10 rounded-full">
        <div 
          className={`h-[2px] rounded-full mt-[-0.5px] transition-all duration-700 ${getScoreColorClass(percentage, true)}`} 
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
