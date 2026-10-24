import React from 'react';
import { AlertCircle, CheckCircle, Microscope } from 'lucide-react';
import { Button } from '../ui/button';
import { Input, inputBaseClass } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { ShamsiDatePicker } from '../ShamsiDatePicker';
import { cn } from '../../lib/utils';

/**
 * The one form for a laboratory record — used for both recording a new result
 * and editing an existing one.
 *
 * Editing used to happen inside the table row: the six cells turned into
 * inputs, so the date sat in a `w-40` box, the QC code in a narrow column, and
 * the analysis report — the field people write the most in — in a two-row
 * textarea squeezed into a `max-w-sm` cell. The validation message landed in
 * the «عملیات» column at `text-2xs`, where nobody looks for it. Same record,
 * same fields, a tenth of the room.
 *
 * So there is one panel now and `mode` changes only the words on it: the
 * heading, the submit label, and the sentence confirming the save. Every
 * measurement — the four-column grid, the full-width comment box, where the
 * error bar sits — is shared, because that is the thing that was different.
 */

export type AnalysisDecision = 'Pass' | 'Reject' | 'Approved Conditional';

export type AnalysisDeviation =
  | 'None' | 'NCR' | 'Deviation' | 'OOS' | 'CAPA' | 'OOT' | 'Complaint' | 'Other';

export interface AnalysisFormValues {
  date: string;
  qcCode: string;
  decision: AnalysisDecision;
  deviationReason: AnalysisDeviation;
  comments: string;
}

/** The empty form, with today's date already filled in (Persian digits folded to ASCII). */
export function emptyAnalysisValues(): AnalysisFormValues {
  return {
    date: new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date())
      .replace(/[۰-۹]/g, c => '0123456789'[c.charCodeAt(0) - 1776]),
    qcCode: '',
    decision: 'Pass',
    deviationReason: 'None',
    comments: '',
  };
}

interface AnalysisRecordFormProps {
  mode: 'add' | 'edit';
  values: AnalysisFormValues;
  onChange: (values: AnalysisFormValues) => void;
  onSubmit: () => void;
  onCancel: () => void;
  /** Validation message, shown in the panel's own error bar. */
  error: string | null;
  /** Replaces the fields with the confirmation panel after a successful save. */
  success: boolean;
}

const DECISIONS: AnalysisDecision[] = ['Pass', 'Approved Conditional', 'Reject'];

const DEVIATIONS: AnalysisDeviation[] = [
  'None', 'NCR', 'Deviation', 'OOS', 'CAPA', 'OOT', 'Complaint', 'Other',
];

export function AnalysisRecordForm({
  mode, values, onChange, onSubmit, onCancel, error, success,
}: AnalysisRecordFormProps) {
  const set = <K extends keyof AnalysisFormValues>(key: K, value: AnalysisFormValues[K]) =>
    onChange({ ...values, [key]: value });

  return (
    <div
      id="analysis-record-form"
      className="mb-6 p-6 rounded-2xl border border-indigo-100 dark:border-indigo-800 bg-indigo-50/25 dark:bg-indigo-950/30 space-y-4"
    >
      {success ? (
        <div className="flex items-center justify-center gap-3 py-8 px-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-800 dark:text-emerald-300 font-bold text-sm fade-in">
          <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400 bounce-in" />
          <span>
            {mode === 'add'
              ? 'سابقه آزمایش با موفقیت ثبت گردید.'
              : 'تغییرات نتیجهٔ آزمایش با موفقیت ذخیره شد.'}
          </span>
        </div>
      ) : (
        <>
          <div className="text-sm font-bold text-indigo-950 dark:text-indigo-300 flex items-center gap-1.5 pb-2 border-b border-indigo-100 dark:border-indigo-800">
            <Microscope className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <span>
              {mode === 'add'
                ? 'فرم ثبت نتایج و سوابق آنالیز ماده'
                : 'ویرایش نتیجهٔ آزمایش ثبت‌شده'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Date */}
            <div>
              <label className="block text-muted-foreground font-semibold text-xs mb-1.5">
                تاریخ آزمایش <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <ShamsiDatePicker
                value={values.date}
                onChange={date => set('date', date)}
                placeholder="YYYY/MM/DD"
              />
            </div>

            {/* QC Code */}
            <div>
              <label className="block text-muted-foreground font-semibold text-xs mb-1.5">
                کد آزمایشگاهی / QC Code <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <Input
                id="analysis-qc-code-input"
                type="text"
                required
                value={values.qcCode}
                onChange={e => set('qcCode', e.target.value)}
                className="w-full font-mono text-left"
                placeholder="مثال: QC-1405-102"
                dir="ltr"
              />
            </div>

            {/* Final decision */}
            <div>
              <label className="block text-muted-foreground font-semibold text-xs mb-1.5">
                نتیجه نهایی (Decision)
              </label>
              <select
                id="analysis-decision-select"
                value={values.decision}
                onChange={e => set('decision', e.target.value as AnalysisDecision)}
                className={cn(inputBaseClass, 'w-full font-medium')}
              >
                {DECISIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {/* Deviation */}
            <div>
              <label className="block text-muted-foreground font-semibold text-xs mb-1.5">
                وضعیت انحراف
              </label>
              <select
                id="analysis-deviation-select"
                value={values.deviationReason}
                onChange={e => set('deviationReason', e.target.value as AnalysisDeviation)}
                className={cn(inputBaseClass, 'w-full font-medium')}
              >
                {DEVIATIONS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          {/* Comments — full width in both modes. This is the field the row-level
              editor cut down to two rows inside a `max-w-sm` cell. */}
          <div>
            <label className="block text-muted-foreground font-semibold text-xs mb-1.5">
              توضیحات و گزارش آنالیز (Comments)
            </label>
            <Textarea
              id="analysis-comments-textarea"
              value={values.comments}
              onChange={e => set('comments', e.target.value)}
              rows={3}
              className="bg-card"
              placeholder="گزارش دقیق آنالیز، درصد خلوص، ناخالصی‌ها، تطابق آزمون‌های فیزیکوشیمیایی یا میکروبیولوژی با مراجع فارماکوپه..."
            />
          </div>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-xl px-3.5 py-2.5 text-xs font-semibold"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              id="analysis-cancel-btn"
              type="button"
              variant="secondary"
              size="sm"
              onClick={onCancel}
              className="font-bold text-muted-foreground"
            >
              انصراف
            </Button>
            <Button
              id="analysis-submit-btn"
              type="button"
              size="sm"
              onClick={onSubmit}
              className="px-4 bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-indigo-600/20 font-bold"
            >
              {mode === 'add' ? 'ثبت آزمایش در سابقه سورس' : 'ذخیرهٔ تغییرات'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
