import { isVendorRejected } from './vendorState';

export type SampleVerdictTone = 'gradeA' | 'gradeC' | 'gradeReject' | 'outline';

export interface SampleVerdict {
  /** True once somebody has recorded a decision about this sample. */
  decided: boolean;
  label: string;
  variant: SampleVerdictTone;
}

/**
 * What a sample's badge should say — in one place, for the four surfaces that
 * were each deciding it on their own.
 *
 * Every one of them assumed a sample always carries a verdict, because the
 * source form used to demand one before any test had been run. Two of them were
 * wrong in a way that mattered: the material table fell through to «Reject» for
 * anything that was not approved or conditional, and the archive printed the
 * binary «نمونه تایید شده» for everything that was not rejected. With samples
 * now arriving undecided, both would have stated a verdict nobody gave.
 */
export function describeSampleStatus(vendor: any): SampleVerdict {
  if (isVendorRejected(vendor)) {
    return { decided: true, label: 'Reject', variant: 'gradeReject' };
  }
  if (vendor?.status === 'approved') return { decided: true, label: 'Approved', variant: 'gradeA' };
  if (vendor?.status === 'conditional') return { decided: true, label: 'Conditional', variant: 'gradeC' };
  return { decided: false, label: 'آزمایش نشده', variant: 'outline' };
}

/** True for a sample nobody has ruled on yet. */
export function isUntestedSample(vendor: any): boolean {
  return !describeSampleStatus(vendor).decided;
}

/**
 * Is this record a sample?
 *
 * Read both fields, always. `isSample` is the flag the form sets and
 * `category === 'sample'` is where the record lives; a row that carries one
 * without the other used to be judged differently by different screens — the
 * source page hid its scoring forms on the flag alone while the lists filtered
 * on either.
 */
export function isSampleRecord(vendor: any): boolean {
  return !!vendor?.isSample || vendor?.category === 'sample';
}
