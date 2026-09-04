import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  ChevronLeft, Printer, Shield, Warehouse, DollarSign, 
  AlertTriangle, Microscope, Handshake, CheckCircle, Star 
} from 'lucide-react';
import { Vendor, Grade, BusinessPartner, Material } from '../types';
import { calculateOverallScore } from '../utils/vendorUtils';
import { getPartnerDetails } from '../utils/printablePartner';
import { criterionCell, departmentNote, earnedCell } from '../utils/printableScores';
import { getDisplayCountry } from '../utils/vendorUtils';
import { categoryLabels } from '../constants/categories';
import { selectionForVendor } from '../utils/sourceSelection';
import { describeVendorRank } from '../utils/vendorRank';
import { formatSelectionDate, type SourceSelectionRecord } from '../utils/sourceSelection';
import { getScoreColorClass, getSRIColorClass } from './ScoreBar';
// @ts-expect-error — the bundler resolves this asset import; TypeScript does not.
import temadLogo from '../assets/logo.png';

/*
 * `getRawScoreValue` is gone. It returned 5 — full marks — for any criterion
 * with nothing recorded against it, so an unevaluated source printed a perfect
 * scorecard, and it derived per-criterion figures by dividing a department's
 * total by 20, which made an estimate look like a recorded score. Both now live
 * in utils/printableScores.ts, where "not recorded" is an answer rather than a
 * value to be filled in.
 */

function getMaterialTypeLabel(v: Vendor) {
  if (v.category === 'packaging') return 'اقلام بسته‌بندی';
  if (v.category === 'sample') return 'نمونه تستی';
  if (v.category === 'veterinary') return 'داروی دامی';
  return 'ماده اولیه (Active / Excipient)';
}

/**
 * Dates on these forms mixed calendars: the print date was Jalali while the
 * evaluation and registration dates came straight from the record as
 * `2026-08-27`. One document should not carry two calendars, so anything that
 * parses as a Gregorian date is shown in Jalali and anything already Persian is
 * left exactly as entered.
 */
function toJalaliDisplay(value: string | null | undefined): string {
  const raw = (value || '').trim();
  if (!raw) return 'ثبت‌نشده';
  // Already Persian (Persian digits or a Jalali-looking year) — leave it alone.
  if (/[۰-۹]/.test(raw) || /^1[34]\d{2}[/-]/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    return d.toLocaleDateString('fa-IR');
  } catch {
    return raw;
  }
}


/**
 * The archive list itself, as a printable A4 landscape document.
 *
 * "PDF" in this module used to mean one evaluation form for one source. There
 * was no way to put the list on paper — the register someone actually hands to
 * an auditor — so the only route was Excel, which is not a document you sign.
 *
 * It prints exactly the rows the screen is showing, filters included, and says
 * so in the header: a printed extract that does not state what it was filtered
 * by is not evidence of anything. Landscape, because the register is wide.
 */
export function PrintableArchiveList({
  vendors,
  filterSummary,
  selections = [],
  onBack,
}: {
  vendors: Vendor[];
  filterSummary: string;
  selections?: SourceSelectionRecord[];
  onBack: () => void;
}) {
  return document.body ? createPortal(
    <>
      <style>{`
        @media print {
          #root { display: none !important; }
          body, html { background-color: white !important; margin: 0; padding: 0; }
          @page { size: A4 landscape; margin: 8mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          /* Repeat the column headings on every sheet and never split a row
             across two pages — a register broken mid-row is unreadable. */
          thead { display: table-header-group; }
          tr { break-inside: avoid; }
        }
      `}</style>
      <div className="fixed inset-0 z-[99999] bg-slate-100 text-slate-900 overflow-y-auto w-full h-full p-4 print:static print:h-auto print:overflow-visible print:bg-white print:p-0 print:block flex flex-col items-center">
        <div className="w-full max-w-[297mm] flex justify-between items-center mb-6 print:hidden bg-white p-4 rounded-xl border border-slate-300 shadow-sm">
          <button onClick={onBack} className="bg-slate-100 hover:bg-slate-200 px-6 py-2 rounded-lg font-medium text-slate-700 transition-colors flex items-center gap-2 border border-slate-300 cursor-pointer">
            <ChevronLeft className="w-5 h-5" />
            بازگشت
          </button>
          <div className="text-xs text-slate-500">
            {vendors.length.toLocaleString('fa-IR')} ردیف آمادهٔ چاپ — برای ذخیره به‌صورت PDF، در پنجرهٔ چاپ گزینهٔ «Save as PDF» را انتخاب کنید.
          </div>
          <button onClick={() => setTimeout(() => window.print(), 100)} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 shadow-sm cursor-pointer">
            <Printer className="w-5 h-5" />
            چاپ فهرست
          </button>
        </div>

        <div className="w-[297mm] bg-white print:w-full print:shadow-none shadow-[0_0_20px_rgba(0,0,0,0.1)] font-sans p-6 print:p-0" dir="rtl">
          <div className="flex border-2 border-blue-900 rounded-xl mb-4 overflow-hidden items-stretch text-right">
            <div className="w-[18%] p-3 flex items-center justify-center border-l-2 border-blue-900">
              <img src={temadLogo} alt="Temad Logo" className="h-[62px] w-auto object-contain" />
            </div>
            <div className="flex-1 flex flex-col justify-center items-center p-3">
              <h1 className="text-lg font-bold text-blue-900">شرکت تولید مواد اولیه داروپخش (تماد)</h1>
              <div className="text-sm font-semibold text-slate-700">فهرست آرشیو تأمین‌کنندگان</div>
            </div>
            <div className="w-[26%] p-3 border-r-2 border-blue-900 bg-blue-900 text-white text-[11px] space-y-1.5">
              <div className="flex justify-between border-b border-blue-800 pb-1">
                <span className="opacity-80">تاریخ چاپ:</span>
                <span>{new Date().toLocaleDateString('fa-IR')}</span>
              </div>
              <div className="flex justify-between border-b border-blue-800 pb-1">
                <span className="opacity-80">تعداد ردیف:</span>
                <span className="font-mono">{vendors.length.toLocaleString('fa-IR')}</span>
              </div>
              <div className="flex justify-between">
                <span className="opacity-80">محدودهٔ گزارش:</span>
                <span className="text-[10px] text-left leading-tight">{filterSummary}</span>
              </div>
            </div>
          </div>

          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="bg-blue-900 text-white">
                {['#', 'تأمین‌کننده', 'ماده', 'CAS', 'دسته', 'کشور', 'گرید', 'سطح ریسک', 'IRC', 'سورس منتخب'].map(h => (
                  <th key={h} className="border border-blue-800 px-2 py-1.5 font-bold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vendors.map((v, i) => {
                const chosen = selectionForVendor(v, selections);
                // Same rule as the single-source form: a grade is printed only
                // when one exists. `new` is a lifecycle state, not a grade, and
                // a total of zero means nobody has scored this source — both
                // used to print as "new (۰)" and "— (۰)", which read on paper
                // like a real, failing evaluation.
                const gradeText = describeVendorRank(v).label;
                return (
                  <tr key={v.id} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                    <td className="border border-slate-300 px-2 py-1 text-center font-mono">{(i + 1).toLocaleString('fa-IR')}</td>
                    <td className="border border-slate-300 px-2 py-1 font-semibold">{v.name}</td>
                    <td className="border border-slate-300 px-2 py-1">{v.material}</td>
                    <td className="border border-slate-300 px-2 py-1 text-center font-mono">{v.cas || '—'}</td>
                    <td className="border border-slate-300 px-2 py-1 text-center">
                      {categoryLabels[v.category as keyof typeof categoryLabels]?.fa || v.category}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-center">{getDisplayCountry(v)}</td>
                    <td className="border border-slate-300 px-2 py-1 text-center font-bold">{gradeText}</td>
                    <td className="border border-slate-300 px-2 py-1 text-center">
                      {['Low', 'Medium', 'High'].includes(String(v.riskAssessment?.riskLevel || ''))
                        ? v.riskAssessment!.riskLevel
                        : 'ارزیابی نشده'}
                    </td>
                    <td className="border border-slate-300 px-2 py-1 text-center font-mono">{v.irc || '—'}</td>
                    <td className={`border border-slate-300 px-2 py-1 text-center font-bold ${chosen ? 'bg-amber-100 text-amber-800' : 'text-slate-400'}`}>
                      {chosen ? '★ منتخب' : '—'}
                    </td>
                  </tr>
                );
              })}
              {vendors.length === 0 && (
                <tr>
                  <td colSpan={10} className="border border-slate-300 px-2 py-6 text-center text-slate-500">
                    با فیلترهای انتخاب‌شده ردیفی برای نمایش وجود ندارد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-4 flex justify-between text-[10px] text-slate-500 border-t border-slate-300 pt-2">
            <span>سامانهٔ ارزیابی و رتبه‌بندی تأمین‌کنندگان (VLSE)</span>
            <span>این فهرست بازتاب وضعیت سامانه در تاریخ چاپ است.</span>
          </div>

          <div className="mt-6 flex gap-4 print:mt-8">
            {['تهیه‌کننده', 'تأیید مدیر کیفیت', 'تأیید مدیر بازرگانی'].map(role => (
              <div key={role} className="flex-1 border border-slate-300 rounded-lg p-3 h-20 flex flex-col justify-between">
                <span className="text-[10px] font-bold text-slate-500">{role}:</span>
                <span className="text-[9px] text-slate-400">امضا و تاریخ</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>,
    document.body
  ) : null;
}

interface PrintableSampleFormProps {
  vendor: Vendor;
  onBack: () => void;
  partners?: BusinessPartner[];
  materials?: Material[];
}

export function PrintableSampleForm({ vendor, onBack, partners = [], materials = [] }: PrintableSampleFormProps) {
  const partnerInfo = getPartnerDetails(vendor, partners);
  const matItem = (materials || []).find(m => 
    (vendor.materialId && m.id === vendor.materialId) ||
    (m.cas && vendor.cas && m.cas.trim().toLowerCase() === vendor.cas.trim().toLowerCase()) ||
    (m.nameFa && vendor.material && m.nameFa.trim().toLowerCase() === vendor.material.trim().toLowerCase()) ||
    (m.nameEn && vendor.materialEn && m.nameEn.trim().toLowerCase() === vendor.materialEn.trim().toLowerCase())
  );

  const finalProductStr = matItem?.finalProduct || 'ثبت‌نشده';
  const casStr = vendor.cas && vendor.cas.toLowerCase() !== 'n/a' && vendor.cas.toLowerCase() !== 'unknown' ? vendor.cas : (matItem?.cas || '-');
  const regDateStr = toJalaliDisplay(vendor.registrationDate || vendor.lastAudit);

  const statusLabel = vendor.status === 'approved' ? 'نمونه تایید شده (Approved Sample)' :
                      vendor.status === 'conditional' ? 'نمونه تایید مشروط (Conditional)' :
                      vendor.status === 'rejected' ? 'نمونه تایید نشده / رد شده (Rejected)' : 'بررسی اولیه / جدید (New/Pending)';
  const statusColor = vendor.status === 'approved' ? 'bg-emerald-600 text-white border-emerald-700' :
                      vendor.status === 'conditional' ? 'bg-amber-500 text-white border-amber-600' :
                      vendor.status === 'rejected' ? 'bg-rose-600 text-white border-rose-700' : 'bg-cyan-500 text-white border-cyan-600';

  return document.body ? createPortal(
    <>
      <style>{`
        @media print {
          #root { display: none !important; }
          body, html { background-color: white !important; margin: 0; padding: 0; }
          @page { size: A4 portrait; margin: 5mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <div className="fixed inset-0 z-[99999] bg-slate-100 text-slate-900 overflow-y-auto w-full h-full p-4 print:static print:h-auto print:overflow-visible print:bg-white print:p-0 print:block flex flex-col items-center">
         {/* Actions toolbar */}
         <div className="w-full max-w-[210mm] flex justify-between items-center mb-6 print:hidden bg-white p-4 rounded-xl border border-slate-300 shadow-sm">
            <button onClick={onBack} className="bg-slate-100 hover:bg-slate-200 px-6 py-2 rounded-lg font-medium text-slate-700 transition-colors flex items-center gap-2 border border-slate-300 cursor-pointer">
              <ChevronLeft className="w-5 h-5" />
              بازگشت
            </button>
            <button onClick={() => setTimeout(() => window.print(), 100)} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 shadow-sm cursor-pointer">
              <Printer className="w-5 h-5" />
              چاپ فرم نمونه تستی
            </button>
         </div>

         {/* A4 Paper Container */}
         <div className="w-[210mm] min-h-[297mm] bg-white print:w-full print:shadow-none shadow-[0_0_20px_rgba(0,0,0,0.1)] font-sans" dir="rtl">
          <div className="p-8 pb-4">
             {/* Header */}
             <div className="flex border-2 border-blue-900 rounded-xl mb-6 overflow-hidden items-stretch text-right">
                <div className="w-1/4 p-4 flex flex-col items-center justify-center border-l-2 border-blue-900">
                   <img src={temadLogo} alt="Temad Logo" className="h-[100px] w-auto object-contain" />
                </div>
                <div className="w-2/4 flex flex-col justify-center items-center p-4 text-center">
                   <h1 className="text-lg font-bold text-blue-900 mb-1">شرکت تولید مواد اولیه داروپخش (تماد)</h1>
                   <div className="text-xs font-semibold text-slate-700">فرم ثبت، آزمایش و ارزیابی مشخصات تجربی نمونه مادی تستی (SAMPLES)</div>
                </div>
                <div className="w-1/4 p-4 border-r-2 border-blue-900 flex flex-col justify-center bg-blue-900 text-white space-y-1 text-right">
                   <div className="flex justify-between items-center text-[10px] border-b border-blue-800 pb-1">
                      <span className="opacity-80">تاریخ چاپ:</span>
                      <span className="font-sans">{new Date().toLocaleDateString('fa-IR')}</span>
                   </div>
                   <div className="flex justify-between items-center text-[10px] border-b border-blue-800 pb-1">
                      <span className="opacity-80">نوع پرونده:</span>
                      <span>نمونه تستی (Sample)</span>
                   </div>
                   <div className="flex justify-between items-center text-[10px]">
                      <span className="opacity-80">شناسه سیستم:</span>
                      <span className="font-mono">{vendor.id.slice(0, 8).toUpperCase()}</span>
                   </div>
                </div>
             </div>

             {/* Meta Info */}
             <div className="flex flex-col border-2 border-slate-300 rounded-xl mb-6 overflow-hidden text-sm bg-slate-50/50 text-right">
                {/* Row 1: دسته کالا | نام کالا (نام فارسی ماده اولیه) | محصول نهایی | نام تولید کننده و کشور */}
                <div className="flex border-b border-slate-300">
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center border-l border-slate-300">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">دسته کالا:</span>
                      <span className="font-bold text-xs">
                        {vendor.category === 'foreign' ? 'خرید خارجی' :
                         vendor.category === 'domestic' ? 'خرید داخلی' :
                         vendor.category === 'veterinary' ? 'خرید دامی' :
                         vendor.category === 'packaging' ? 'اقلام بسته‌بندی' :
                         vendor.category === 'sample' ? 'نمونه' :
                         vendor.category === 'blacklist' ? 'لیست سیاه' : 'نامشخص'}
                      </span>
                   </div>
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center border-l border-slate-300">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">نام کالا (فارسی):</span>
                      <span className="font-bold text-xs">{vendor.material || 'ثبت‌نشده'}</span>
                   </div>
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center border-l border-slate-300">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">محصول نهایی:</span>
                      <span className="font-bold text-xs">{finalProductStr}</span>
                   </div>
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">نام تولید کننده و کشور:</span>
                      <span className="font-bold text-xs">{partnerInfo.mfgName} ({partnerInfo.mfgCountry})</span>
                   </div>
                </div>

                {/* Row 2: نام فروشنده و کشور | شماره CAS | کد IRC و تاریخ صدور مجوز | تاریخ ارزیابی */}
                <div className="flex bg-white">
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center border-l border-slate-300">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">نام فروشنده و کشور:</span>
                      <span className="font-bold text-xs">{partnerInfo.supName} ({partnerInfo.supCountry})</span>
                   </div>
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center border-l border-slate-300">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">CAS No.:</span>
                      <span className="font-bold text-xs font-mono" dir="ltr">{casStr}</span>
                   </div>
                   <div className="w-1/4 flex flex-col border-l border-slate-300 justify-between">
                      <div className="flex-1 p-1 flex flex-col items-center justify-center text-center border-b border-slate-300">
                         <span className="text-slate-500 font-light text-[10px] leading-tight mb-0.5">کد IRC:</span>
                         <span className="font-bold text-xs font-mono" dir="ltr">{vendor.irc && vendor.irc.toLowerCase() !== 'n/a' && vendor.irc.toLowerCase() !== 'unknown' ? vendor.irc : '-'}</span>
                      </div>
                      <div className="flex-1 p-1 flex flex-col items-center justify-center text-center">
                         <span className="text-slate-500 font-light text-[10px] leading-tight mb-0.5">تاریخ صدور مجوز:</span>
                         <span className="font-bold text-xs font-mono">{regDateStr}</span>
                      </div>
                   </div>
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">تاریخ ارزیابی:</span>
                      <span className="font-bold text-xs font-mono">{toJalaliDisplay(vendor.lastAudit || vendor.registrationDate)}</span>
                   </div>
                </div>
             </div>

             {/* Explanatory banner */}
             <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-4 mb-6 text-xs leading-relaxed text-right">
                <strong>پیوست آیین‌نامه ارزیابی تامین‌کنندگان شرکت تماد:</strong> کالاهایی که تحت عنوان <strong>«فرم نمونه آزمایشی»</strong> در سامانه به ثبت می‌رسند، به لحاظ ماهیت از ارزیابی ریسک کلی سالانه و فرآیند امتیازدهی چندجانبه دپارتمان‌های تجاری (بازرگانی، مالی و انبار) معاف می‌باشند. ارزیابی این موارد به بررسی فیزیکی اولیه در دپارتمان کیفیت (QA) و انطباق آزمایشگاهی توسط واحدهای آزمایشگاهی فنی مربوطه تخصیص یافته است.
             </div>

             {/* Physical and documentation Checklist */}
             <div className="border border-slate-300 rounded-xl overflow-hidden mb-6 text-right">
                <div className="bg-slate-100 px-4 py-2 border-b border-slate-300 text-slate-800 font-bold text-sm">
                  ۱. نتایج بررسی‌های فیزیکی ظاهری و مستندات نمونه (Checklist)
                </div>
                <div className="grid grid-cols-2 text-xs divide-x-reverse divide-x divide-y divide-slate-200">
                  <div className="p-3 flex items-center justify-between gap-2">
                    <span className="text-slate-600">پلمپ و بسته‌بندی محفظه نمونه:</span>
                    <div className="flex gap-4 font-bold">
                      <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> مناسب و سالم</span>
                      <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> معیوب/مخدوش</span>
                    </div>
                  </div>
                  <div className="p-3 flex items-center justify-between gap-2">
                    <span className="text-slate-600">برگه آنالیز سازنده (COA):</span>
                    <div className="flex gap-4 font-bold">
                      <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> همراه‌بسته دارد</span>
                      <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> کسر مدرک COA</span>
                    </div>
                  </div>
                  <div className="p-3 flex items-center justify-between gap-2">
                    <span className="text-slate-600">برگه ایمنی و فنی (MSDS/TDS):</span>
                    <div className="flex gap-4 font-bold">
                      <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> ارائه گردیده</span>
                      <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> ناقص / کسر مدرک</span>
                    </div>
                  </div>
                  <div className="p-3 flex items-center justify-between gap-2">
                    <span className="text-slate-600">برگانطباق مندرجات لیبل بسته‌بندی با ماده:</span>
                    <div className="flex gap-4 font-bold">
                      <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> کاملا منطبق</span>
                      <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> دارای مغایرت</span>
                    </div>
                  </div>
                </div>
             </div>

             {/* Laboratory Parameters Evaluation Table */}
             <div className="border border-slate-300 rounded-xl overflow-hidden mb-6 text-right">
                <div className="bg-slate-100 px-4 py-2 border-b border-slate-300 text-slate-800 font-bold text-sm">
                  ۲. بررسی‌های آزمایشگاهی و کنترل کیفیت نمونه (QC Lab Control Details)
                </div>
                <div className="p-4 text-xs space-y-4">
                  <div className="grid grid-cols-3 gap-4 text-right">
                    <div>
                      <span className="text-slate-500 block mb-1 font-semibold">شماره بچ نمونه آزمایشگاهی (Test Batch No):</span>
                      <div className="p-2 border border-dashed border-slate-300 rounded bg-slate-50 h-8 font-mono text-center"></div>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-1 font-semibold">مقدار نمونه واصله (Sample Weight):</span>
                      <div className="p-2 border border-dashed border-slate-300 rounded bg-slate-50 h-8 text-center"></div>
                    </div>
                    <div>
                      <span className="text-slate-500 block mb-1 font-semibold">تاریخ تکمیل تست در آزمایشگاه:</span>
                      <div className="p-2 border border-dashed border-slate-300 rounded bg-slate-50 h-8 text-center"></div>
                    </div>
                  </div>

                  <table className="w-full text-center border border-slate-200 mt-4 text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-bold">
                      <tr className="border-b border-slate-200">
                        <th className="py-2.5 px-2 border-l border-slate-200 text-right">شاخص‌های آزمایش کالا</th>
                        <th className="py-2.5 px-2 border-l border-slate-200">مشخصه فنی تعریف شده مرجع (Specs)</th>
                        <th className="py-2.5 px-2 border-l border-slate-200">مقدار آزمون اخذ شده آزمایشگاهی</th>
                        <th className="py-2.5 px-2">نتیجه و تصمیم کارشناس</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      <tr>
                        <td className="py-3 px-2 border-l border-slate-200 text-slate-700 font-medium text-right">شکل فیزیکی، رنگ و بو (Appearance)</td>
                        <td className="py-3 px-2 border-l border-slate-200 italic text-slate-500 font-mono">Conforms to Standard Checklist</td>
                        <td className="py-3 px-2 border-l border-slate-200 text-slate-300">................................................</td>
                        <td className="py-3 px-2 flex justify-center gap-3">
                          <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> منطبق (Pass)</span>
                          <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> نامنطبق (Fail)</span>
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3 px-2 border-l border-slate-200 text-slate-700 font-medium text-right">آنالیز کیفی شناسایی (Identification)</td>
                        <td className="py-3 px-2 border-l border-slate-200 italic text-slate-500 font-mono">Positive Reaction / FTIR Conformance</td>
                        <td className="py-3 px-2 border-l border-slate-200 text-slate-300">................................................</td>
                        <td className="py-3 px-2 flex justify-center gap-3">
                          <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> منطبق (Pass)</span>
                          <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> نامنطبق (Fail)</span>
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3 px-2 border-l border-slate-200 text-slate-700 font-medium text-right">پلوت و تعیین ناخالصی دفتری (Impurities)</td>
                        <td className="py-3 px-2 border-l border-slate-200 italic text-slate-500 font-mono">Within Pharmacopoeia Criteria Limits</td>
                        <td className="py-3 px-2 border-l border-slate-200 text-slate-300">................................................</td>
                        <td className="py-3 px-2 flex justify-center gap-3">
                          <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> منطبق (Pass)</span>
                          <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> نامنطبق (Fail)</span>
                        </td>
                      </tr>
                      <tr>
                        <td className="py-3 px-2 border-l border-slate-200 text-slate-700 font-medium text-right">درصد خلوص یا عیار نهایی (Assay/Purity)</td>
                        <td className="py-3 px-2 border-l border-slate-200 italic text-slate-500 font-mono">According requested COA parameters</td>
                        <td className="py-3 px-2 border-l border-slate-200 text-slate-300">................................................</td>
                        <td className="py-3 px-2 flex justify-center gap-3">
                          <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> منطبق (Pass)</span>
                          <span className="flex items-center gap-1"><span className="w-3.5 h-3.5 border border-slate-400 rounded-sm inline-block"></span> نامنطبق (Fail)</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
             </div>

             {/* Opinion and signature workflow */}
             <div className="grid grid-cols-2 gap-4 mb-6 text-right">
                <div className="border border-slate-300 rounded-xl p-4 text-xs flex flex-col justify-between h-36">
                  <div>
                    <strong className="text-slate-800 block mb-1">۳. نظر فنی کارشناسی بخش تحقیق و توسعه (R&D Verdict):</strong>
                    <p className="text-slate-400 leading-relaxed font-semibold">محل درج گزارش نهایی عملکرد آزمایشی نمونه در فرمولاسیون و انطباق اولیه ساخت آزمایشگاهی...</p>
                  </div>
                  <div className="flex justify-between items-center border-t border-slate-100 pt-2 text-slate-500 text-[10px]">
                    <span>محل امضاء کارشناس R&D:</span>
                    <span>تاریخ ثبت: ..............................</span>
                  </div>
                </div>

                <div className="border border-slate-300 rounded-xl p-4 text-xs flex flex-col justify-between h-36">
                  <div>
                    <strong className="text-slate-800 block mb-1">۴. اعلام نظر سرپرست آزمایشگاه‌های کنترل کیفیت (QC Lab Supervisor):</strong>
                    <p className="text-slate-400 leading-relaxed font-semibold">توضیحات تکمیلی پیرامون نتایج آنالیزهای فوق و مونتوگراف‌های مرجع آزمایشگاهی...</p>
                  </div>
                  <div className="flex justify-between items-center border-t border-slate-100 pt-2 text-slate-500 text-[10px]">
                    <span>امضاء مسئول آزمایشگاه QC تماد:</span>
                    <span>تاریخ ثبت: ..............................</span>
                  </div>
                </div>
             </div>

             {/* QA Final Approved Banner */}
             <div className="border-2 border-slate-300 rounded-xl p-4 bg-slate-50/50 mb-6 font-sans text-right">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center text-white ${statusColor} text-lg font-black shrink-0 border shadow-md`}>
                      {vendor.status === 'approved' ? 'OK' : vendor.status === 'conditional' ? 'COND' : vendor.status === 'rejected' ? 'REJ' : 'PEND'}
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block font-semibold">تصمیم‌گیری نهایی دپارتمان کیفیت (QA Final Disposition)</span>
                      <span className="text-base font-bold block mt-0.5">{statusLabel}</span>
                    </div>
                  </div>

                  <div className="text-[10px] text-slate-600 text-left border-r border-slate-200 pr-6 pl-2 space-y-1">
                    <div>مسئول کنترل کیفیت: <strong>دپارتمان کیفیت تماد</strong></div>
                    <div>تاریخ ارزیابی نمونه: <strong>{toJalaliDisplay(vendor.lastAudit) || 'نامشخص'}</strong></div>
                    <div>مهر و امضاء نهایی مدیر کیفیت تماد: <strong>..............................</strong></div>
                  </div>
                </div>
             </div>

             {/* Printable footer */}
             <div className="text-center text-[10px] text-slate-400 border-t border-slate-200 pt-3 pb-8">
                * این فرم صرفاً پس از ثبت سیستمی پرونده جهت تاییدات نهایی فیزیکی آزمایشگاهی نمونه مادی تولید شده و فاقد ارزش ارزیابی ریسک سالانه است.
             </div>
          </div>
         </div>
      </div>
    </>,
    document.body
  ) : null;
}

interface PrintableEvaluationFormProps {
  vendor: Vendor;
  onBack: () => void;
  partners?: BusinessPartner[];
  materials?: Material[];
  /** The recorded decision this source is, when it is the chosen one. */
  selection?: SourceSelectionRecord | null;
}

export function PrintableEvaluationForm({ vendor, onBack, partners = [], materials = [], selection = null }: PrintableEvaluationFormProps) {
  if (vendor.isSample) {
    return <PrintableSampleForm vendor={vendor} onBack={onBack} partners={partners} materials={materials} />;
  }
  const partnerInfo = getPartnerDetails(vendor, partners);
  const matItem = (materials || []).find(m => 
    (vendor.materialId && m.id === vendor.materialId) ||
    (m.cas && vendor.cas && m.cas.trim().toLowerCase() === vendor.cas.trim().toLowerCase()) ||
    (m.nameFa && vendor.material && m.nameFa.trim().toLowerCase() === vendor.material.trim().toLowerCase()) ||
    (m.nameEn && vendor.materialEn && m.nameEn.trim().toLowerCase() === vendor.materialEn.trim().toLowerCase())
  );

  const finalProductStr = matItem?.finalProduct || 'ثبت‌نشده';
  const casStr = vendor.cas || matItem?.cas || 'N/A';
  const regDateStr = toJalaliDisplay(vendor.registrationDate || vendor.lastAudit);

  const overall = calculateOverallScore(vendor.scores, true);

  /**
   * The rank printed on the form.
   *
   * The fallback used to be `D (0-39)`, which every unevaluated source fell
   * into: a supplier with no scores and a null grade printed as a failing
   * grade on a document that gets signed and filed. Saying "not evaluated" is
   * the truth; saying D is a claim nobody made.
   */
  // The scale itself lives in vendorRank.ts, shared with the Excel export —
  // the two had drifted onto different rubrics. Only the colour is local.
  const ranked = describeVendorRank(vendor);
  const isEvaluated = ranked.evaluated;
  const GRADE_COLORS: Record<string, string> = {
    A: 'bg-emerald-600', B: 'bg-[#0071E3]', C: 'bg-amber-500', D: 'bg-red-500',
  };
  const rank = {
    label: ranked.grade || '—',
    score: ranked.range,
    color: ranked.grade ? GRADE_COLORS[ranked.grade] : 'bg-slate-200',
  };

  const getRiskColor = (level: string | undefined) => {
    if (level === 'Low') return 'bg-emerald-500 text-white';
    if (level === 'Medium') return 'bg-amber-500 text-white';
    if (level === 'High') return 'bg-red-500 text-white';
    return 'bg-slate-100 text-slate-500 border border-slate-300';
  };
  
  // «N/A» روی سندی که به ممیز می‌رود مبهم است — نمی‌گوید ریسک ارزیابی شده و
  // نتیجه‌اش مصداق ندارد یا اصلاً ارزیابی نشده. مثل گرید، صریح می‌نویسیم.
  const getRiskLabel = (level: string | undefined) => {
    if (level === 'Low') return 'Low';
    if (level === 'Medium') return 'Medium';
    if (level === 'High') return 'High';
    return 'ارزیابی نشده';
  };
  const riskAssessed = ['Low', 'Medium', 'High'].includes(
    String(vendor.riskAssessment?.riskLevel || ''),
  );

  return document.body ? createPortal(
    <>
      <style>{`
        @media print {
          #root { display: none !important; }
          body, html { background-color: white !important; margin: 0; padding: 0; }
          @page { size: A4 portrait; margin: 5mm; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <div className="fixed inset-0 z-[99999] bg-slate-100 text-slate-900 overflow-y-auto w-full h-full p-4 print:static print:h-auto print:overflow-visible print:bg-white print:p-0 print:block flex flex-col items-center">
         {/* Actions toolbar */}
         <div className="w-full max-w-[210mm] flex justify-between items-center mb-6 print:hidden bg-white p-4 rounded-xl border border-slate-300 shadow-sm">
            <button onClick={onBack} className="bg-slate-100 hover:bg-slate-200 px-6 py-2 rounded-lg font-medium text-slate-700 transition-colors flex items-center gap-2 border border-slate-300 cursor-pointer">
              <ChevronLeft className="w-5 h-5" />
              بازگشت
            </button>
            <button onClick={() => setTimeout(() => window.print(), 100)} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 shadow-sm cursor-pointer">
              <Printer className="w-5 h-5" />
              چاپ فرم
            </button>
         </div>

         {/* A4 Paper Container */}
         <div className="w-[210mm] min-h-[297mm] bg-white print:w-full print:shadow-none shadow-[0_0_20px_rgba(0,0,0,0.1)] font-sans" dir="rtl">
          <div className="p-8 pb-4">
             {/* Header */}
             <div className="flex border-2 border-blue-900 rounded-xl mb-6 overflow-hidden items-stretch text-right">
                <div className="w-1/4 p-4 flex flex-col items-center justify-center border-l-2 border-blue-900">
                   <img src={temadLogo} alt="Temad Logo" className="h-[100px] w-auto object-contain" />
                </div>
                <div className="w-2/4 flex flex-col justify-center items-center p-4 text-center">
                   <h1 className="text-xl font-bold text-blue-900 mb-2">شرکت تولید مواد اولیه داروپخش (تماد)</h1>
                   <div className="text-sm font-semibold text-slate-700">ارزیابی تامین کنندگان</div>
                </div>
                <div className="w-1/4 p-4 border-r-2 border-blue-900 flex flex-col justify-center bg-blue-900 text-white space-y-2 text-right">
                   <div className="flex justify-between items-center text-[11px] border-b border-blue-800 pb-1">
                      <span className="opacity-80">تاریخ چاپ:</span>
                      <span className="font-sans">{new Date().toLocaleDateString('fa-IR')}</span>
                   </div>
                   {/* The row here used to read "شماره صفحه: ۱ از ۱" — hardcoded,
                       while a source with a long history prints over more than
                       one sheet. A filed document must not miscount its own
                       pages, and the browser already prints a real page number
                       in its own footer, so the false claim is simply gone. */}
                   <div className="flex justify-between items-center text-[11px]">
                      <span className="opacity-80">کد ارجاع سیستمی:</span>
                      <span className="font-mono">{vendor.id.slice(0, 8).toUpperCase()}</span>
                   </div>
                </div>
             </div>

             {/* The recorded decision, printed only when there is one.
                 A form that said "chosen: no" on every other source would be
                 noise on a document that is signed and filed; the absence of
                 this band is the answer for those. Reason, who decided and when
                 are all here, because on paper there is no tooltip to ask. */}
             {selection && (
               <div className="flex items-stretch border-2 border-amber-500 rounded-xl mb-6 overflow-hidden text-right bg-amber-50">
                  <div className="px-4 py-3 bg-amber-500 text-white flex items-center gap-2 shrink-0">
                     <Star className="w-5 h-5 fill-current" />
                     <span className="font-bold text-sm whitespace-nowrap">سورس منتخب</span>
                  </div>
                  <div className="flex-1 p-3 text-[11px] text-slate-800 leading-relaxed">
                     <div>
                       این تأمین‌کننده به‌عنوان <strong>سورس منتخب</strong> برای
                       {' '}«{vendor.material || vendor.materialEn}» ثبت شده است.
                     </div>
                     <div className="mt-1">
                       <span className="text-slate-500">دلیل انتخاب: </span>
                       <span className="font-semibold">{selection.reason}</span>
                     </div>
                     <div className="mt-0.5 text-slate-600">
                       ثبت‌کننده: <span className="font-semibold">{selection.decidedBy}</span>
                       {formatSelectionDate(selection.decidedAt) && (
                         <> · تاریخ ثبت: <span className="font-mono">{formatSelectionDate(selection.decidedAt)}</span></>
                       )}
                     </div>
                  </div>
               </div>
             )}

             {/* Meta Info Evaluation Form */}
             <div className="flex flex-col border-2 border-slate-300 rounded-xl mb-6 overflow-hidden text-sm bg-slate-50/50 text-right">
                {/* Row 1: دسته کالا | نام کالا (نام فارسی ماده اولیه) | محصول نهایی | نام تولید کننده و کشور */}
                <div className="flex border-b border-slate-300">
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center border-l border-slate-300">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">دسته کالا:</span>
                      <span className="font-bold text-xs">
                        {vendor.category === 'foreign' ? 'خرید خارجی' :
                         vendor.category === 'domestic' ? 'خرید داخلی' :
                         vendor.category === 'veterinary' ? 'خرید دامی' :
                         vendor.category === 'packaging' ? 'اقلام بسته‌بندی' :
                         vendor.category === 'sample' ? 'نمونه' :
                         vendor.category === 'blacklist' ? 'لیست سیاه' : 'نامشخص'}
                      </span>
                   </div>
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center border-l border-slate-300">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">نام کالا (فارسی):</span>
                      <span className="font-bold text-xs">{vendor.material || 'ثبت‌نشده'}</span>
                   </div>
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center border-l border-slate-300">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">محصول نهایی:</span>
                      <span className="font-bold text-xs">{finalProductStr}</span>
                   </div>
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">نام تولید کننده و کشور:</span>
                      <span className="font-bold text-xs">{partnerInfo.mfgName} ({partnerInfo.mfgCountry})</span>
                   </div>
                </div>

                {/* Row 2: نام فروشنده و کشور | شماره CAS | کد IRC و تاریخ صدور مجوز | تاریخ ارزیابی */}
                <div className="flex bg-white">
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center border-l border-slate-300">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">نام فروشنده و کشور:</span>
                      <span className="font-bold text-xs">{partnerInfo.supName} ({partnerInfo.supCountry})</span>
                   </div>
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center border-l border-slate-300">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">CAS No.:</span>
                      <span className="font-bold text-xs font-mono" dir="ltr">{casStr}</span>
                   </div>
                   <div className="w-1/4 flex flex-col border-l border-slate-300 justify-between">
                      <div className="flex-1 p-1 flex flex-col items-center justify-center text-center border-b border-slate-300">
                         <span className="text-slate-500 font-light text-[10px] leading-tight mb-0.5">کد IRC:</span>
                         <span className="font-bold text-xs font-mono" dir="ltr">{vendor.irc && vendor.irc.toLowerCase() !== 'n/a' && vendor.irc.toLowerCase() !== 'unknown' ? vendor.irc : '-'}</span>
                      </div>
                      <div className="flex-1 p-1 flex flex-col items-center justify-center text-center">
                         <span className="text-slate-500 font-light text-[10px] leading-tight mb-0.5">تاریخ صدور مجوز:</span>
                         <span className="font-bold text-xs font-mono">{regDateStr}</span>
                      </div>
                   </div>
                   <div className="w-1/4 p-2.5 flex flex-col items-center justify-center text-center">
                      <span className="text-slate-500 font-light mb-1 text-[11px]">تاریخ ارزیابی:</span>
                      <span className="font-bold text-xs font-mono">{toJalaliDisplay(vendor.lastAudit || vendor.registrationDate)}</span>
                   </div>
                </div>
             </div>

             {/* Dept 1: Commercial */}
             <div className="flex border-2 border-slate-300 rounded-xl mb-4 overflow-hidden text-right">
                <div className="w-1/5 bg-slate-100 flex flex-col items-center justify-center p-2 border-l border-slate-300 text-center">
                   <div className="text-xs text-center font-bold text-slate-700 mb-2">واحد ارزیابی کننده: بازرگانی</div>
                   {/* Says plainly when a unit recorded nothing, or recorded
                       only a total: a reader of the printed form should not
                       have to infer from a column of dashes. */}
                   {departmentNote(vendor, 'commercial') && (
                     <div className="text-[9px] leading-snug text-amber-700 font-semibold mb-2 px-1">
                       {departmentNote(vendor, 'commercial')}
                     </div>
                   )}
                   <div className="w-8 h-8 bg-blue-100 text-[#0071E3] rounded-full flex items-center justify-center mb-1">
                     <Handshake className="w-4 h-4" />
                   </div>
                   <div className="text-[10px] text-green-600 flex items-center gap-1 mt-2 font-semibold">
                     <CheckCircle className="w-3 h-3" /> تأیید مدیر بازرگانی
                   </div>
                </div>
                <div className="w-4/5 text-sm flex flex-col">
                   <table className="w-full text-center">
                      <thead className="bg-slate-100/50 border-b border-slate-300 text-slate-600 text-xs font-bold">
                         <tr>
                           <th className="py-2 px-1 w-[42%] font-medium text-right pr-3">فاکتورهای ارزیابی</th>
                           <th className="py-2 px-1 w-[14%] font-medium">وزن</th>
                           <th className="py-2 px-1 w-[22%] font-medium">امتیاز کسب شده</th>
                           <th className="py-2 px-1 w-[22%] font-medium">امتیاز نهایی</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                         <tr>
                           <td className="py-2 px-1 text-right pr-3 text-xs font-semibold">تحویل به موقع</td>
                           <td className="py-2 px-1 font-mono">40</td>
                           <td className="py-2 px-1 font-mono">{criterionCell(vendor, 'commercial', 'delivery')}</td>
                           <td className="py-2 px-1 bg-slate-50 font-bold font-mono">{earnedCell(vendor, 'commercial', 'delivery', 40)}</td>
                         </tr>
                         <tr>
                           <td className="py-2 px-1 text-right pr-3 text-xs font-semibold">پاسخگویی و جبران سازی</td>
                           <td className="py-2 px-1 font-mono">30</td>
                           <td className="py-2 px-1 font-mono">{criterionCell(vendor, 'commercial', 'responsiveness')}</td>
                           <td className="py-2 px-1 bg-slate-50 font-bold font-mono">{earnedCell(vendor, 'commercial', 'responsiveness', 30)}</td>
                         </tr>
                         <tr>
                           <td className="py-2 px-1 text-right pr-3 text-xs font-semibold">سابقه همکاری و تعداد دفعات خرید</td>
                           <td className="py-2 px-1 font-mono">30</td>
                           <td className="py-2 px-1 font-mono">{criterionCell(vendor, 'commercial', 'history')}</td>
                           <td className="py-2 px-1 bg-slate-50 font-bold font-mono">{earnedCell(vendor, 'commercial', 'history', 30)}</td>
                         </tr>
                         <tr className="bg-slate-100 font-bold">
                           <td className="py-2 px-1 text-right pr-3 text-xs">جمع</td>
                           <td className="py-2 px-1 font-mono">100</td>
                           <td className="py-2 px-1"></td>
                           <td className={`py-2 px-1 font-mono font-black ${getScoreColorClass(vendor.scores?.commercial || 0)}`}>{vendor.scores?.commercial || 0}</td>
                         </tr>
                      </tbody>
                   </table>
                </div>
             </div>

             {/* Dept 2: QA */}
             <div className="flex border-2 border-slate-300 rounded-xl mb-4 overflow-hidden text-right">
                <div className="w-1/5 bg-slate-100 flex flex-col items-center justify-center p-2 border-l border-slate-300 text-center">
                   <div className="text-xs text-center font-bold text-slate-700 mb-2">واحد ارزیابی کننده: کیفیت</div>
                   {/* Says plainly when a unit recorded nothing, or recorded
                       only a total: a reader of the printed form should not
                       have to infer from a column of dashes. */}
                   {departmentNote(vendor, 'qa') && (
                     <div className="text-[9px] leading-snug text-amber-700 font-semibold mb-2 px-1">
                       {departmentNote(vendor, 'qa')}
                     </div>
                   )}
                   <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-1">
                     <Shield className="w-4 h-4" />
                   </div>
                   <div className="text-[10px] text-green-600 flex items-center gap-1 mt-2 font-semibold">
                     <CheckCircle className="w-3 h-3" /> تأیید مدیر کیفیت
                   </div>
                </div>
                <div className="w-4/5 text-sm flex flex-col">
                   <table className="w-full text-center">
                      <thead className="bg-slate-100/50 border-b border-slate-300 text-slate-600 text-xs font-bold">
                         <tr>
                           <th className="py-2 px-1 w-[42%] font-medium text-right pr-3">فاکتورهای ارزیابی</th>
                           <th className="py-2 px-1 w-[14%] font-medium">وزن</th>
                           <th className="py-2 px-1 w-[22%] font-medium">امتیاز کسب شده</th>
                           <th className="py-2 px-1 w-[22%] font-medium">امتیاز نهایی</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                         <tr>
                           <td className="py-2 px-1 text-right pr-3 text-xs font-semibold">کیفیت و تطابق با مشخصات</td>
                           <td className="py-2 px-1 font-mono">35</td>
                           <td className="py-2 px-1 font-mono">{criterionCell(vendor, 'qa', 'quality')}</td>
                           <td className="py-2 px-1 bg-slate-50 font-bold font-mono">{earnedCell(vendor, 'qa', 'quality', 35)}</td>
                         </tr>
                         <tr>
                           <td className="py-2 px-1 text-right pr-3 text-xs font-semibold">تداوم کیفیت</td>
                           <td className="py-2 px-1 font-mono">25</td>
                           <td className="py-2 px-1 font-mono">{criterionCell(vendor, 'qa', 'consistency')}</td>
                           <td className="py-2 px-1 bg-slate-50 font-bold font-mono">{earnedCell(vendor, 'qa', 'consistency', 25)}</td>
                         </tr>
                         <tr>
                           <td className="py-2 px-1 text-right pr-3 text-xs font-semibold">نتایج Deviation, OOS</td>
                           <td className="py-2 px-1 font-mono">25</td>
                           <td className="py-2 px-1 font-mono">{criterionCell(vendor, 'qa', 'ncr')}</td>
                           <td className="py-2 px-1 bg-slate-50 font-bold font-mono">{earnedCell(vendor, 'qa', 'ncr', 25)}</td>
                         </tr>
                         <tr>
                           <td className="py-2 px-1 text-right pr-3 text-xs font-semibold">ارائه مستندات درخواستی</td>
                           <td className="py-2 px-1 font-mono">15</td>
                           <td className="py-2 px-1 font-mono">{criterionCell(vendor, 'qa', 'documents')}</td>
                           <td className="py-2 px-1 bg-slate-50 font-bold font-mono">{earnedCell(vendor, 'qa', 'documents', 15)}</td>
                         </tr>
                         <tr className="bg-slate-100 font-bold">
                           <td className="py-2 px-1 text-right pr-3 text-xs">جمع</td>
                           <td className="py-2 px-1 font-mono">100</td>
                           <td className="py-2 px-1"></td>
                           <td className={`py-2 px-1 font-mono font-black ${getScoreColorClass(vendor.scores?.qa || 0)}`}>{vendor.scores?.qa || 0}</td>
                         </tr>
                      </tbody>
                   </table>
                </div>
             </div>

             {/* Dept 3: QC/Planning */}
             <div className="flex border-2 border-slate-300 rounded-xl mb-4 overflow-hidden text-right">
                <div className="w-1/5 bg-slate-100 flex flex-col items-center justify-center p-2 border-l border-slate-300 text-center">
                   <div className="text-xs text-center font-bold text-slate-700 mb-2">واحد ارزیابی کننده: برنامه‌ریزی و انبار</div>
                   {/* Says plainly when a unit recorded nothing, or recorded
                       only a total: a reader of the printed form should not
                       have to infer from a column of dashes. */}
                   {departmentNote(vendor, 'planning') && (
                     <div className="text-[9px] leading-snug text-amber-700 font-semibold mb-2 px-1">
                       {departmentNote(vendor, 'planning')}
                     </div>
                   )}
                   <div className="w-8 h-8 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mb-1">
                     <Warehouse className="w-4 h-4" />
                   </div>
                   <div className="text-[10px] text-green-600 flex items-center gap-1 mt-2 font-semibold">
                     <CheckCircle className="w-3 h-3" /> تأیید مدیر برنامه‌ریزی
                   </div>
                </div>
                <div className="w-4/5 text-sm flex flex-col">
                   <table className="w-full text-center">
                      <thead className="bg-slate-100/50 border-b border-slate-300 text-slate-600 text-xs font-bold">
                         <tr>
                           <th className="py-2 px-1 w-[42%] font-medium text-right pr-3">فاکتورهای ارزیابی</th>
                           <th className="py-2 px-1 w-[14%] font-medium">وزن</th>
                           <th className="py-2 px-1 w-[22%] font-medium">امتیاز کسب شده</th>
                           <th className="py-2 px-1 w-[22%] font-medium">امتیاز نهایی</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                         <tr>
                           <td className="py-2 px-1 text-right pr-3 text-xs font-semibold">راندمان</td>
                           <td className="py-2 px-1 font-mono">60</td>
                           <td className="py-2 px-1 font-mono">{criterionCell(vendor, 'planning', 'efficiency')}</td>
                           <td className="py-2 px-1 bg-slate-50 font-bold font-mono">{earnedCell(vendor, 'planning', 'efficiency', 60)}</td>
                         </tr>
                         <tr>
                           <td className="py-2 px-1 text-right pr-3 text-xs font-semibold">تطابق کالا با مشخصات فنی پکینگ لیست</td>
                           <td className="py-2 px-1 font-mono">40</td>
                           <td className="py-2 px-1 font-mono">{criterionCell(vendor, 'planning', 'conformance')}</td>
                           <td className="py-2 px-1 bg-slate-50 font-bold font-mono">{earnedCell(vendor, 'planning', 'conformance', 40)}</td>
                         </tr>
                         <tr className="bg-slate-100 font-bold">
                           <td className="py-2 px-1 text-right pr-3 text-xs">جمع</td>
                           <td className="py-2 px-1 font-mono">100</td>
                           <td className="py-2 px-1"></td>
                           <td className={`py-2 px-1 font-mono font-black ${getScoreColorClass(vendor.scores?.planning || 0)}`}>{vendor.scores?.planning || 0}</td>
                         </tr>
                      </tbody>
                   </table>
                </div>
             </div>

             {/* Dept 4: Finance */}
             <div className="flex border-2 border-slate-300 rounded-xl mb-8 overflow-hidden text-right">
                <div className="w-1/5 bg-slate-100 flex flex-col items-center justify-center p-2 border-l border-slate-300 text-center">
                   <div className="text-xs text-center font-bold text-slate-700 mb-2">واحد ارزیابی کننده: مالی</div>
                   {/* Says plainly when a unit recorded nothing, or recorded
                       only a total: a reader of the printed form should not
                       have to infer from a column of dashes. */}
                   {departmentNote(vendor, 'finance') && (
                     <div className="text-[9px] leading-snug text-amber-700 font-semibold mb-2 px-1">
                       {departmentNote(vendor, 'finance')}
                     </div>
                   )}
                   <div className="w-8 h-8 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-1">
                     <DollarSign className="w-4 h-4" />
                   </div>
                   <div className="text-[10px] text-green-600 flex items-center gap-1 mt-2 font-semibold">
                     <CheckCircle className="w-3 h-3" /> تأیید مدیر مالی
                   </div>
                </div>
                <div className="w-4/5 text-sm flex flex-col">
                   <table className="w-full text-center">
                      <thead className="bg-slate-100/50 border-b border-slate-300 text-slate-600 text-xs font-bold">
                         <tr>
                           <th className="py-2 px-1 w-[42%] font-medium text-right pr-3">فاکتورهای ارزیابی</th>
                           <th className="py-2 px-1 w-[14%] font-medium">وزن</th>
                           <th className="py-2 px-1 w-[22%] font-medium">امتیاز کسب شده</th>
                           <th className="py-2 px-1 w-[22%] font-medium">امتیاز نهایی</th>
                         </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                         <tr>
                           <td className="py-2 px-1 text-right pr-3 text-xs font-semibold">قیمت</td>
                           <td className="py-2 px-1 font-mono">60</td>
                           <td className="py-2 px-1 font-mono">{criterionCell(vendor, 'finance', 'price')}</td>
                           <td className="py-2 px-1 bg-slate-50 font-bold font-mono">{earnedCell(vendor, 'finance', 'price', 60)}</td>
                         </tr>
                         <tr>
                           <td className="py-2 px-1 text-right pr-3 text-xs font-semibold">نوع پرداخت</td>
                           <td className="py-2 px-1 font-mono">40</td>
                           <td className="py-2 px-1 font-mono">{criterionCell(vendor, 'finance', 'payment')}</td>
                           <td className="py-2 px-1 bg-slate-50 font-bold font-mono">{earnedCell(vendor, 'finance', 'payment', 40)}</td>
                         </tr>
                         <tr className="bg-slate-100 font-bold">
                           <td className="py-2 px-1 text-right pr-3 text-xs">جمع</td>
                           <td className="py-2 px-1 font-mono">100</td>
                           <td className="py-2 px-1"></td>
                           <td className={`py-2 px-1 font-mono font-black ${getScoreColorClass(vendor.scores?.finance || 0)}`}>{vendor.scores?.finance || 0}</td>
                         </tr>
                      </tbody>
                   </table>
                </div>
             </div>

             {/* Final Evaluation & SPS Banner */}
             <div className="flex rounded-2xl overflow-hidden mb-6 shadow-sm border border-blue-950 text-right" dir="rtl">
                {/* 8 Columns of Scores (Right Part - Blue) */}
                <div className="flex-1 bg-[#121f42] text-white flex flex-col justify-center">
                  <div className="flex text-center text-xs opacity-90 border-b border-white/10 py-2.5">
                     <div className="w-[15%]">امتیاز بازرگانی</div>
                     <div className="w-[10%] border-r border-white/10">وزن</div>
                     <div className="w-[15%] border-r border-white/10">امتیاز کیفیت</div>
                     <div className="w-[10%] border-r border-white/10">وزن</div>
                     <div className="w-[15%] border-r border-white/10">امتیاز انبار</div>
                     <div className="w-[10%] border-r border-white/10">وزن</div>
                     <div className="w-[15%] border-r border-white/10">امتیاز مالی</div>
                     <div className="w-[10%] border-r border-white/10">وزن</div>
                  </div>
                  <div className="flex text-center py-3 items-center font-bold text-base">
                     <div className="w-[15%] text-lg">{vendor.scores?.commercial || 0}</div>
                     <div className="w-[10%] border-r border-white/10 text-xs font-mono font-normal opacity-80">20%</div>
                     <div className="w-[15%] border-r border-white/10 text-lg">{vendor.scores?.qa || 0}</div>
                     <div className="w-[10%] border-r border-white/10 text-xs font-mono font-normal opacity-80">40%</div>
                     <div className="w-[15%] border-r border-white/10 text-lg">{vendor.scores?.planning || 0}</div>
                     <div className="w-[10%] border-r border-white/10 text-xs font-mono font-normal opacity-80">10%</div>
                     <div className="w-[15%] border-r border-white/10 text-lg">{vendor.scores?.finance || 0}</div>
                     <div className="w-[10%] border-r border-white/10 text-xs font-mono font-normal opacity-80">30%</div>
                  </div>
                </div>

                {/* SPS Index (Left Part - Green) */}
                <div className={`w-[18%] ${getScoreColorClass(overall, true)} text-white flex flex-col items-center justify-center p-3 border-r border-blue-950`}>
                  <div className="text-[10px] sm:text-xs font-medium opacity-90 mb-1">شاخص (SPS)</div>
                  <div className="text-3xl font-black font-sans tracking-tight">{overall || 0}</div>
                </div>
             </div>

             {/* Risk Assessment Block */}
             <div className="border border-slate-300 rounded-2xl mb-6 overflow-hidden flex shadow-sm min-h-[90px] text-right" dir="rtl">
                {/* Right vertical box representing risk assessment */}
                <div className="w-[18%] bg-slate-50 flex flex-col items-center justify-center p-2 border-l border-slate-300 text-center">
                   <div className="text-xs font-bold text-slate-700 mb-1">ارزیابی ریسک کیفی</div>
                   <div className="text-red-500 font-bold flex flex-col items-center gap-0.5 mt-1">
                      <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                      <span className="text-[10px] text-slate-600 font-medium">کیفیت</span>
                   </div>
                </div>
                {/* 5 Column Data Block */}
                <div className="flex-1 flex items-center bg-white text-slate-700 text-sm">
                   <div className="w-[20%] flex flex-col items-center justify-center border-l border-slate-200/60 pb-1 pt-0.5">
                      <div className="text-[10px] text-slate-500 font-bold mb-1 text-center leading-tight">اهمیت ماده (از ۵)<br/>(Material Criticality)</div>
                      <div className="text-lg font-bold font-mono text-slate-800">{vendor.riskAssessment?.materialCriticality || '-'}</div>
                   </div>
                   <div className="w-[20%] flex flex-col items-center justify-center border-l border-slate-200/60 pb-1 pt-0.5">
                      <div className="text-[10px] text-slate-500 font-bold mb-1 text-center leading-tight">احتمال خرابی (از ۵)<br/>(Probability of failure)</div>
                      <div className="text-lg font-bold font-mono text-slate-800">{vendor.riskAssessment?.probability || '-'}</div>
                   </div>
                   <div className="w-[20%] flex flex-col items-center justify-center border-l border-slate-200/60 pb-1 pt-0.5">
                      <div className="text-[10px] text-slate-500 font-bold mb-1 text-center leading-tight">تشخیص (از ۵)<br/>(Detectability)</div>
                      <div className="text-lg font-bold font-mono text-slate-800">{vendor.riskAssessment?.detectability || '-'}</div>
                   </div>
                   <div className="w-[20%] flex flex-col items-center justify-center border-l border-slate-200/60 pb-1 pt-0.5 bg-slate-50/50">
                      <div className="text-[10px] text-slate-500 font-bold mb-1 text-center leading-tight">نمره ریسک<br/>(RPN)</div>
                      <div className="text-lg font-bold font-mono text-slate-800">{vendor.riskAssessment?.riskScore || '-'}</div>
                   </div>
                   <div className="w-[20%] flex flex-col items-center justify-center pb-1 pt-0.5 bg-slate-50/50">
                      <div className={`text-[10px] ${getSRIColorClass(vendor.riskAssessment?.sri)} font-bold mb-1 text-center leading-tight`}>شاخص<br/>(SRI)</div>
                      <div className={`text-lg font-bold font-mono ${getSRIColorClass(vendor.riskAssessment?.sri)} font-black`}>{vendor.riskAssessment?.sri !== undefined && vendor.riskAssessment?.sri !== null ? Number(vendor.riskAssessment.sri).toFixed(1) : '-'}</div>
                   </div>
                </div>
             </div>

             {/* Analysis Records */}
             {vendor.analysisRecords && vendor.analysisRecords.length > 0 && (
                <div className="flex border-2 border-slate-300 rounded-xl mb-6 overflow-hidden print:break-inside-avoid text-right">
                   <div className="w-1/5 bg-slate-100 flex flex-col items-center justify-center p-2 border-l border-slate-300 text-center">
                      <div className="text-xs font-bold text-slate-700 mb-2 font-semibold">سوابق آزمایشگاهی (QC)</div>
                      <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-1">
                        <Microscope className="w-4 h-4" />
                      </div>
                      <div className="text-[10px] text-slate-500 mt-2 leading-tight">
                        موتور محاسبه و آنالیز<br/>(نتایج تست)
                      </div>
                   </div>
                   <div className="w-4/5 text-sm flex flex-col p-0">
                      <table className="w-full text-center">
                        <thead className="bg-slate-100/50 border-b border-slate-300 text-slate-500 text-[10px] uppercase tracking-wider font-bold">
                           <tr>
                             <th className="py-2 px-1">کد QC</th>
                             <th className="py-2 px-1 border-r border-slate-200">تصمیم</th>
                             <th className="py-2 px-1 border-r border-slate-200">وضعیت انحراف</th>
                             <th className="py-2 px-1 border-r border-slate-200 text-right pr-2">توضیحات</th>
                             <th className="py-2 px-1 border-r border-slate-200">تاریخ</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-xs">
                           {vendor.analysisRecords.map((r, i) => (
                              <tr key={i}>
                                <td className="py-2 px-1 font-mono font-bold tracking-wide">{r.qcCode}</td>
                                <td className={`py-2 px-1 border-r border-slate-200 font-bold ${r.decision === 'Pass' || r.decision === 'Approved Conditional' ? 'text-emerald-600' : 'text-red-600'}`}>
                                  {r.decision}
                                </td>
                                <td className="py-2 px-1 border-r border-slate-200 text-[10px]">{r.deviationReason}</td>
                                <td className="py-2 px-1 border-r border-slate-200 text-right pr-2 text-slate-600">{r.comments || '-'}</td>
                                <td className="py-2 px-1 border-r border-slate-200 font-mono text-slate-500">{r.date}</td>
                              </tr>
                           ))}
                           <tr className="bg-slate-50/80 font-bold text-xs border-t-2 border-slate-300">
                             <td colSpan={5} className="py-2 text-right pr-4 text-indigo-700">
                                جمع‌بندی عملکرد آزمایشگاهی: {vendor.analysisRecords.filter(r => r.decision === 'Pass' || r.decision === 'Approved Conditional').length} تست تایید شده از کل {vendor.analysisRecords.length} تست. این نتایج در موتور انتخاب سورس برتر در قالب ضریب کیفی تأثیرگذار است.
                             </td>
                           </tr>
                        </tbody>
                      </table>
                   </div>
                </div>
             )}

             {/* Grades */}
             <div className="flex items-stretch rounded-xl overflow-hidden border border-slate-300 text-sm shadow-sm relative mb-4 mt-8 text-right">
                <div className="bg-slate-100 p-3 w-32 border-l border-slate-300 flex items-center justify-center text-center font-bold text-slate-700">رتبه تأمین کننده</div>
                <div className="flex-1 flex">
                  <div className="flex-1 bg-emerald-500 flex flex-col justify-center items-center text-white p-2">
                    <div className="font-bold text-xl">A</div>
                    <div className="text-xs opacity-90">(80 - 100)</div>
                  </div>
                  <div className="flex-1 bg-[#0071E3] flex flex-col justify-center items-center text-white p-2 border-r border-slate-200/20">
                    <div className="font-bold text-xl">B</div>
                    <div className="text-xs opacity-90">(60 - 79)</div>
                  </div>
                  <div className="flex-1 bg-amber-500 flex flex-col justify-center items-center text-white p-2 border-r border-slate-200/20">
                    <div className="font-bold text-xl">C</div>
                    <div className="text-xs opacity-90">(40 - 59)</div>
                  </div>
                  <div className="flex-1 bg-red-500 flex flex-col justify-center items-center text-white p-2 border-r border-slate-200/20">
                    <div className="font-bold text-xl">D</div>
                    <div className="text-xs opacity-90">(0 - 39)</div>
                  </div>
                </div>
             </div>

             {/* Final Result Card */}
             <div className="flex justify-between items-center bg-slate-50 border border-slate-300 rounded-2xl p-4 shadow-sm text-right" dir="rtl">
                  {/* Right Section: Total Score */}
                  <div className="flex items-center gap-3">
                    {/* `overall || 0` printed a bold 0 for a source nobody has
                        scored yet, which reads as "scored zero" — the same
                        false claim the D grade made. An em dash says the number
                        does not exist. */}
                    <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center border-2 border-slate-200 text-slate-700 font-bold text-xl font-mono shadow-sm">
                      {overall !== null ? overall : '—'}
                    </div>
                    <div className="flex flex-col text-right">
                      <span className="text-xs text-slate-500 font-bold">جمع امتیاز نهایی</span>
                      <span className="text-sm font-bold text-slate-700 font-mono mt-0.5">{overall || 0} از 100</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6 mr-auto pr-6 pl-2">
                    {/* Middle Section: Risk Level */}
                    <div className="flex items-center gap-3">
                      <div className="text-[11px] text-slate-500 font-bold leading-tight text-right">سطح ریسک<br/>ارزیابی شده</div>
                      <div className={`px-4 py-2 rounded-lg font-extrabold whitespace-nowrap ${riskAssessed ? 'text-sm' : 'text-xs'} ${getRiskColor(vendor.riskAssessment?.riskLevel)}`}>
                         {getRiskLabel(vendor.riskAssessment?.riskLevel)}
                      </div>
                    </div>

                    <div className="w-px h-10 bg-slate-200 mx-2"></div>

                    {/* Left Section: Supplier Rank */}
                    <div className="flex items-center gap-3">
                      <div className="text-xs text-slate-500 font-bold font-semibold">رتبه تأمین کننده:</div>
                      {isEvaluated ? (
                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-white text-2xl font-black shadow-md ${getScoreColorClass(overall, true)}`}>
                           {rank.label}
                        </div>
                      ) : (
                        <div className="px-3 h-12 rounded-lg flex items-center justify-center bg-slate-100 border border-slate-300 text-slate-600 text-[11px] font-bold text-center leading-tight">
                           ارزیابی<br/>نشده
                        </div>
                      )}
                    </div>
                  </div>
             </div>
             
             <div className="mt-8 flex justify-between gap-4 text-right	" dir="rtl">
                  {[
                    "کیفیت",
                    "برنامه‌ریزی و انبار",
                    "بازرگانی",
                    "مالی"
                  ].map((dept, i) => (
                    <div key={i} className="flex-1 border-2 border-slate-300 border-solid rounded-xl p-4 h-32 flex flex-col justify-between relative bg-white">
                      <div className="text-xs font-bold text-slate-500 mb-1">دپارتمان ارزیاب:</div>
                      <div className="text-sm font-bold text-slate-800 border-b border-slate-200 pb-2 mb-2">{dept}</div>
                      <div className="text-xs font-bold text-slate-400 mt-auto">محل امضا و تاریخ:</div>
                    </div>
                  ))}
             </div>
             
             <div className="mt-8 text-center text-xs text-slate-400 border-t border-slate-200 pt-4 pb-12 print:pb-4">
                * این فرم به منظور ارزیابی عملکرد تأمین‌کننده بر اساس معیارهای تعیین شده سیستم طراحی گردیده است.
             </div>
          </div>
         </div>
      </div>
    </>,
    document.body
  ) : null;
}
