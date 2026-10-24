import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { VendorDetail } from '../../src/components/vendor/VendorDetail';
import { applyDerivedState } from '../../src/utils/vendorState';
import type { AnalysisRecord, User, Vendor } from '../../src/types';

/**
 * Recording a laboratory result and editing one are the same form.
 *
 * They were not. Recording used a full-width panel above the table; editing
 * turned the six cells of the row into inputs, so the analysis report — the
 * field people write the most in — became a two-row textarea inside a
 * `max-w-sm` cell, and the validation message was rendered in the «عملیات»
 * column at `text-2xs`. Same record, same fields, a tenth of the room.
 *
 * These assertions are about the measurements that differed, not about the
 * wording: one panel, one comment box of the same height, one error bar.
 */

const admin: User = { username: 'admin', name: 'مدیر کیفیت', role: 'admin' } as User;

const record: AnalysisRecord = {
  id: 'rec-1',
  date: '1405/04/12',
  qcCode: 'QC-1405-102',
  decision: 'Pass',
  deviationReason: 'OOS',
  comments: 'خلوص ۹۹٫۴٪ — مطابق فارماکوپه اروپا.',
  recordedBy: 'کارشناس آزمایشگاه',
} as AnalysisRecord;

const source = (records: AnalysisRecord[] = [record]): Vendor =>
  applyDerivedState({
    id: 'V-LAB',
    category: 'foreign',
    material: 'پاراستامول',
    materialEn: 'Paracetamol',
    cas: '103-90-2',
    name: 'شرکت آزمون',
    nameEn: 'Trial Co',
    country: 'India',
    status: 'new',
    grade: null,
    rejectedByDecision: false,
    scores: null,
    analysisRecords: records,
  } as unknown as Vendor);

const show = (v: Vendor, onSave = () => {}) =>
  render(
    <VendorDetail
      vendor={v}
      vendors={[v]}
      onBack={() => {}}
      onSave={onSave}
      onDelete={() => {}}
      currentUser={admin}
    />,
  );

/** The textarea both modes must share. */
const comments = () => document.getElementById('analysis-comments-textarea') as HTMLTextAreaElement;
const qcCode = () => document.getElementById('analysis-qc-code-input') as HTMLInputElement;
const panel = () => document.getElementById('analysis-record-form');

/**
 * The laboratory section sits behind the evaluation stepper, so every case has
 * to walk to that step first — exactly as a user does.
 */
const openLabSection = () => fireEvent.click(screen.getByText('ثبت نتایج آزمایشگاهی'));

const clickEdit = () => fireEvent.click(screen.getByTitle('ویرایش'));
const clickNew = () => fireEvent.click(screen.getByText('ثبت نتیجه آزمایش جدید'));

describe('the laboratory results form', () => {
  test('neither form is open until somebody asks for one', () => {
    show(source());
    openLabSection();
    expect(panel()).toBeNull();
  });

  test('editing a record opens the same panel, filled in', () => {
    show(source());
    openLabSection();
    clickEdit();

    expect(panel()).toBeTruthy();
    expect(qcCode().value).toBe('QC-1405-102');
    expect(comments().value).toBe('خلوص ۹۹٫۴٪ — مطابق فارماکوپه اروپا.');
    expect((document.getElementById('analysis-deviation-select') as HTMLSelectElement).value)
      .toBe('OOS');
  });

  test('the comment box is the same size in both modes', () => {
    // This is the reported complaint, measured: the row-level editor gave this
    // field `rows={2}` inside a `max-w-sm` cell.
    const { unmount } = show(source());
    openLabSection();
    clickNew();
    const whenAdding = comments().rows;
    unmount();

    show(source());
    openLabSection();
    clickEdit();
    expect(comments().rows).toBe(whenAdding);
    expect(whenAdding).toBe(3);
  });

  test('opening one mode closes the other', () => {
    show(source());
    openLabSection();
    clickEdit();
    expect(qcCode().value).toBe('QC-1405-102');

    clickNew();
    // The add form is a blank one, not the record still sitting in the fields.
    expect(qcCode().value).toBe('');
    expect(screen.getByText('فرم ثبت نتایج و سوابق آنالیز ماده')).toBeTruthy();
  });

  test('a missing QC code is reported in the panel, not in the actions column', () => {
    const saves: Vendor[] = [];
    show(source(), (v: Vendor) => { saves.push(v); });
    openLabSection();
    clickEdit();

    fireEvent.change(qcCode(), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('ذخیرهٔ تغییرات'));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('کد آزمایشگاهی (QC Code) را وارد کنید.');
    // The error bar belongs to the panel, where the eye already is.
    expect(panel()!.contains(alert)).toBe(true);
    expect(saves.length).toBe(0);
  });

  test('a saved edit replaces that record and keeps the editor in its history', () => {
    const saves: Vendor[] = [];
    show(source(), (v: Vendor) => { saves.push(v); });
    openLabSection();
    clickEdit();

    fireEvent.change(comments(), { target: { value: 'بازبینی دوم: تأیید شد.' } });
    fireEvent.click(screen.getByText('ذخیرهٔ تغییرات'));

    expect(saves.length).toBe(1);
    const written = saves[0].analysisRecords!;
    expect(written.length).toBe(1);
    expect(written[0].id).toBe('rec-1');
    expect(written[0].comments).toBe('بازبینی دوم: تأیید شد.');
    expect(written[0].qcCode).toBe('QC-1405-102');
    // Who last touched a laboratory record is part of the GxP history.
    expect(written[0].recordedBy).toBe('مدیر کیفیت (ویرایشگر)');
  });

  test('recording a result appends rather than replacing', () => {
    const saves: Vendor[] = [];
    show(source(), (v: Vendor) => { saves.push(v); });
    openLabSection();
    clickNew();

    fireEvent.change(qcCode(), { target: { value: 'QC-1405-200' } });
    fireEvent.click(screen.getByText('ثبت آزمایش در سابقه سورس'));

    expect(saves.length).toBe(1);
    const written = saves[0].analysisRecords!;
    expect(written.length).toBe(2);
    expect(written[1].qcCode).toBe('QC-1405-200');
    expect(written[1].recordedBy).toBe('مدیر کیفیت');
  });
});
