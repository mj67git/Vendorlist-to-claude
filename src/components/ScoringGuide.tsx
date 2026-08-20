import React from 'react';
import { Info } from 'lucide-react';
import { User } from '../types';
import { ScoreBar, getScoreColorClass } from './ScoreBar';

interface ScoringGuideProps {
  currentUser: User | null;
}

export function ScoringGuide({ currentUser }: ScoringGuideProps) {
  return (
    <div className="bg-white border border-[#E5E5EA] rounded-2xl p-6 shadow-sm border-r-4 border-r-[#0071E3] fade-in text-sm text-[#1D1D1F] text-right">
      <h4 className="font-bold text-[#1D1D1F] mb-3 text-base flex items-center justify-end gap-2">
        راهنمای امتیازدهی و ضرایب
        <Info className="w-5 h-5 text-[#0071E3]" />
      </h4>
      <ul className="list-disc list-inside space-y-1.5 text-[#6E6E73] mb-4 text-xs leading-relaxed">
        <li>هر ویژگی بر اساس عملکرد تامین‌کننده، امتیازی بین ۱ تا ۵ می‌گیرد (۱ = ضعیف‌ترین، ۵ = بهترین).</li>
        <li>جمع امتیاز هر دپارتمان از ۱۰۰ نمره بر اساس وزن داخلی هر ویژگی محاسبه می‌شود.</li>
        <li>ضریب امتیازدهی نهایی (اعمال شده در محاسبه گرید کل):
          {currentUser?.role === 'admin' ? (
            <span className="font-mono text-[#0071E3] mx-2 fade-in font-semibold">بازرگانی: ۰.۲ | کیفیت: ۰.۴ | برنامه‌ریزی/انبار: ۰.۱ | مالی: ۰.۳</span>
          ) : currentUser?.role === 'commercial' ? (
            <span className="font-mono text-[#0071E3] mx-2 fade-in font-semibold">واحد شما (بازرگانی): ۰.۲</span>
          ) : currentUser?.role === 'qa' ? (
            <span className="font-mono text-[#0071E3] mx-2 fade-in font-semibold">واحد شما (کیفیت): ۰.۴</span>
          ) : currentUser?.role === 'planning' ? (
            <span className="font-mono text-[#0071E3] mx-2 fade-in font-semibold">واحد شما (برنامه‌ریزی و انبار): ۰.۱</span>
          ) : currentUser?.role === 'finance' ? (
            <span className="font-mono text-[#0071E3] mx-2 fade-in font-semibold">واحد شما (مالی): ۰.۳</span>
          ) : null}
        </li>
      </ul>
      <div className="flex flex-wrap gap-4 items-center mt-2 border-t border-[#E5E5EA] pt-4 justify-end">
        <div className="flex items-center gap-2 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-100">
          <span className="font-mono text-emerald-700 font-bold">Grade A</span>
          <span className="text-emerald-600 text-xs mx-1">امتیاز ۸۰ تا ۱۰۰</span>
        </div>
        <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-100">
          <span className="font-mono text-[#0071E3] font-bold">Grade B</span>
          <span className="text-blue-600 text-xs mx-1">امتیاز ۶۰ تا ۷۹</span>
        </div>
        <div className="flex items-center gap-2 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-100">
          <span className="font-mono text-amber-700 font-bold">Grade C</span>
          <span className="text-amber-600 text-xs mx-1">امتیاز ۴۰ تا ۵۹</span>
        </div>
        <div className="flex items-center gap-2 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-100">
          <span className="font-mono text-rose-700 font-bold">لیست سیاه</span>
          <span className="text-rose-600 text-xs mx-1">امتیاز ۰ تا ۳۹</span>
        </div>
      </div>
    </div>
  );
}

interface ScoreCardProps {
  title: string;
  titleEn: string;
  icon: any;
  score: number;
  items: { label: string; value: number; max?: number }[];
}

export function ScoreCard({ title, titleEn, icon: Icon, score, items }: ScoreCardProps) {
  const colorClass = getScoreColorClass(score);
  return (
    <div className="bg-white border border-slate-900/10 rounded-xl p-4 shadow-sm text-right hover:border-cyan-500/30 transition-colors relative overflow-hidden flex flex-col justify-between h-full">
      <div className={`absolute top-0 right-0 w-full h-[3px] opacity-80 ${getScoreColorClass(score, true)}`} />
      
      <div>
        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2.5 text-right">
            <div className="p-2 rounded-lg bg-slate-50 border border-slate-900/10 flex-shrink-0">
              <Icon className="w-4 h-4 text-slate-500" />
            </div>
            <div className="text-right">
              <h4 className="font-bold text-slate-800 text-xs sm:text-sm leading-tight mt-0.5">{title}</h4>
              <div className="text-[9px] text-slate-400 font-mono uppercase tracking-wider">{titleEn}</div>
            </div>
          </div>
          <div className={`text-2xl font-black font-mono tracking-tighter ${colorClass}`}>
            {score}
          </div>
        </div>

        <div className="space-y-0.5 mt-2">
          {items.map((item, i) => (
            <ScoreBar key={i} label={item.label} value={item.value} max={item.max} />
          ))}
        </div>
      </div>
    </div>
  );
}
