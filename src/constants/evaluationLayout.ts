import { Handshake, Microscope, Warehouse, Coins } from 'lucide-react';

/**
 * The four scoring departments, their criteria and weights.
 * Shared by the evaluation form, the score helpers and the vendor detail view.
 */

export const FORM_LAYOUT = [
  {
    id: 'commercial', title: 'بازرگانی', icon: Handshake,
    criteria: [
      { key: 'delivery', label: 'تحویل به موقع', weight: 40 },
      { key: 'responsiveness', label: 'پاسخگویی و جبران خسارت', weight: 30 },
      { key: 'history', label: 'سابقه همکاری و تعداد دفعات خرید', weight: 30 }
    ]
  },
  {
    id: 'qa', title: 'کیفیت', icon: Microscope,
    criteria: [
      { key: 'quality', label: 'کیفیت و تطابق با مشخصات', weight: 35 },
      { key: 'consistency', label: 'تداوم کیفیت', weight: 25 },
      { key: 'ncr', label: 'نداشتن OOS, NCR و Deviation', weight: 25 },
      { key: 'documents', label: 'ارائه مستندات درخواستی', weight: 15 }
    ]
  },
  {
    id: 'planning', title: 'برنامه‌ریزی و انبار', icon: Warehouse,
    criteria: [
      { key: 'efficiency', label: 'راندمان', weight: 60 },
      { key: 'conformance', label: 'تطابق کالا با مشخصات فنی درج شده در پکینگ لیست', weight: 40 }
    ]
  },
  {
    id: 'finance', title: 'مالی', icon: Coins,
    criteria: [
      { key: 'price', label: 'قیمت', weight: 60 },
      { key: 'payment', label: 'نوع پرداخت', weight: 40 }
    ]
  }
];
