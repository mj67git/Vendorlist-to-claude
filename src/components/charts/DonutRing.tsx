import React from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';

/**
 * The dashboard's grade ring, in a chunk of its own.
 *
 * `recharts` is the largest library in the bundle — 114.6 KB gzipped, about a
 * third of the first load — and it was pulled in eagerly because the dashboard
 * imported it directly. Loading it here, behind `React.lazy`, keeps it out of
 * the first paint: the legend beside the ring is plain markup and renders
 * immediately, and the ring arrives a moment later.
 *
 * Default export, because that is what `React.lazy` takes.
 */

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
  /** The band the slice stands for, shown under its name in the legend. */
  hint?: string;
}

export default function DonutRing({ slices, total }: { slices: DonutSlice[]; total: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={38} outerRadius={62} paddingAngle={2} strokeWidth={2}>
          {slices.map((d, i) => <Cell key={i} fill={d.color} stroke="var(--card)" />)}
        </Pie>
        <RTooltip
          contentStyle={{ fontFamily: 'Vazirmatn FD', fontSize: 12, borderRadius: 10, border: '1px solid var(--border)' }}
          formatter={(v: number, n: string) => [`${v} (${total > 0 ? Math.round((v / total) * 100) : 0}%)`, n]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
