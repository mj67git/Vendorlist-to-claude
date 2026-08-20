import { BusinessPartner } from './types';

export const INITIAL_BUSINESS_PARTNERS_DB: BusinessPartner[] = [
  {
    id: 'bp_mfg_1',
    type: 'Manufacturer',
    name: 'BASF SE',
    country: 'آلمان',
    city: 'لودویگزهافن',
    address: 'Carl-Bosch-Straße 38, 67056 Ludwigshafen',
    email: 'contact@basf.com',
    contactPerson: 'Dr. Klaus Weber',
    phone: '+49 621 60-0',
    website: 'https://www.basf.com',
    status: 'Active',
    createdAt: '2026-01-15T08:00:00.000Z',
    updatedAt: '2026-01-15T08:00:00.000Z'
  },
  {
    id: 'bp_mfg_2',
    type: 'Manufacturer',
    name: 'Lonza Group AG',
    country: 'سوئیس',
    city: 'بازل',
    address: 'Muenchensteinerstrasse 38, CH-4002 Basel',
    email: 'info@lonza.com',
    contactPerson: 'Sarah Jenkins',
    phone: '+41 61 316 8111',
    website: 'https://www.lonza.com',
    status: 'Active',
    createdAt: '2026-01-20T09:30:00.000Z',
    updatedAt: '2026-01-20T09:30:00.000Z'
  },
  {
    id: 'bp_mfg_3',
    type: 'Manufacturer',
    name: 'Zhejiang Tianyu Pharmaceutical Co., Ltd.',
    country: 'چین',
    city: 'تایژو',
    address: 'No. 189, Huangyan Development Zone, Zhejiang',
    email: 'sales@tianyupda.com',
    contactPerson: 'Li Wei',
    phone: '+86 576 8427 1234',
    website: 'http://www.tianyupda.com',
    status: 'Active',
    createdAt: '2026-02-01T10:15:00.000Z',
    updatedAt: '2026-02-01T10:15:00.000Z'
  },
  {
    id: 'bp_mfg_4',
    type: 'Manufacturer',
    name: 'داروسازی سیناژن (CinnaGen)',
    country: 'ایران',
    city: 'تهران',
    address: 'شهرک صنعتی سیمین دشت، خیابان هفتم',
    email: 'info@cinnagen.com',
    contactPerson: 'مهندس علوی',
    phone: '021-42915000',
    website: 'https://www.cinnagen.com',
    status: 'Active',
    createdAt: '2026-02-10T11:00:00.000Z',
    updatedAt: '2026-02-10T11:00:00.000Z'
  },
  {
    id: 'bp_sup_1',
    type: 'Supplier',
    name: 'Biesterfeld Spezialchemie GmbH',
    country: 'آلمان',
    city: 'هامبورگ',
    address: 'Ferdinandstraße 41, 20095 Hamburg',
    email: 'pharma@biesterfeld.com',
    contactPerson: 'Hans Mueller',
    phone: '+49 40 32008-0',
    website: 'https://www.biesterfeld.com',
    manufacturerId: 'bp_mfg_1',
    status: 'Active',
    evaluation: {
      totalScore: 95,
      grade: 'A',
      status: 'Approved Supplier',
      updatedAt: '2026-02-15T14:20:00.000Z',
      documents: {
        manufacturerLetter: {
          key: 'manufacturerLetter',
          nameFa: 'نامه‌نگاری و معرفی‌نامه سازنده',
          nameEn: 'Manufacturer Letter',
          status: 'Approved',
          score: 20,
          fileName: 'BASF_Authorization_Letter_2026.pdf',
          fileSize: 1048576,
          uploadedAt: '2026-02-15T14:20:00.000Z'
        },
        authorizedSignatory: {
          key: 'authorizedSignatory',
          nameFa: 'صاحبان امضای مجاز',
          nameEn: 'Authorized Signatory',
          status: 'Approved',
          score: 20,
          fileName: 'Signatory_Proof_Biesterfeld.pdf',
          fileSize: 524288,
          uploadedAt: '2026-02-15T14:20:00.000Z'
        },
        businessLicense: {
          key: 'businessLicense',
          nameFa: 'پروانه / مجوز فعالیت قانونی',
          nameEn: 'Business License',
          status: 'Approved',
          score: 20,
          fileName: 'Hamburg_Trade_License_2026.pdf',
          fileSize: 2097152,
          uploadedAt: '2026-02-15T14:20:00.000Z'
        },
        officialEnglishTranslation: {
          key: 'officialEnglishTranslation',
          nameFa: 'ترجمه رسمی انگلیسی مدارک',
          nameEn: 'Official English Translation',
          status: 'Approved',
          score: 20,
          fileName: 'Translation_Certificate_Official.pdf',
          fileSize: 819200,
          uploadedAt: '2026-02-15T14:20:00.000Z'
        },
        legalization: {
          key: 'legalization',
          nameFa: 'تاییدیه سفارت / کنسولی (لگالایزیشن)',
          nameEn: 'Legalization',
          status: 'Permit Approval',
          score: 15,
          fileName: 'Embasssy_Legalization_Receipt.pdf',
          fileSize: 307200,
          uploadedAt: '2026-02-15T14:20:00.000Z'
        }
      }
    },
    createdAt: '2026-02-15T14:20:00.000Z',
    updatedAt: '2026-02-15T14:20:00.000Z'
  },
  {
    id: 'bp_sup_2',
    type: 'Supplier',
    name: 'Sinoway Industrial Co., Ltd.',
    country: 'چین',
    city: 'شیامن',
    address: 'Suite 1802, International Plaza, Xiamen',
    email: 'export@sinowaychem.com',
    contactPerson: 'Chen Lin',
    phone: '+86 592 5055 888',
    website: 'http://www.sinowaychem.com',
    manufacturerId: 'bp_mfg_3',
    status: 'Active',
    evaluation: {
      totalScore: 80,
      grade: 'B',
      status: 'Approved with Monitoring',
      updatedAt: '2026-02-18T16:45:00.000Z',
      documents: {
        manufacturerLetter: {
          key: 'manufacturerLetter',
          nameFa: 'نامه‌نگاری و معرفی‌نامه سازنده',
          nameEn: 'Manufacturer Letter',
          status: 'Approved',
          score: 20,
          fileName: 'Tianyu_Authorization_Sinoway.pdf',
          fileSize: 912000,
          uploadedAt: '2026-02-18T16:45:00.000Z'
        },
        authorizedSignatory: {
          key: 'authorizedSignatory',
          nameFa: 'صاحبان امضای مجاز',
          nameEn: 'Authorized Signatory',
          status: 'Approved',
          score: 20,
          fileName: 'Sinoway_Signatory_Doc.pdf',
          fileSize: 450000,
          uploadedAt: '2026-02-18T16:45:00.000Z'
        },
        businessLicense: {
          key: 'businessLicense',
          nameFa: 'پروانه / مجوز فعالیت قانونی',
          nameEn: 'Business License',
          status: 'Approved',
          score: 20,
          fileName: 'China_Business_License_Xiamen.pdf',
          fileSize: 1500000,
          uploadedAt: '2026-02-18T16:45:00.000Z'
        },
        officialEnglishTranslation: {
          key: 'officialEnglishTranslation',
          nameFa: 'ترجمه رسمی انگلیسی مدارک',
          nameEn: 'Official English Translation',
          status: 'Permit Approval',
          score: 10,
          fileName: 'English_Translation_Pending.pdf',
          fileSize: 600000,
          uploadedAt: '2026-02-18T16:45:00.000Z'
        },
        legalization: {
          key: 'legalization',
          nameFa: 'تاییدیه سفارت / کنسولی (لگالایزیشن)',
          nameEn: 'Legalization',
          status: 'Permit Approval',
          score: 10,
          fileName: 'Legalization_Application.pdf',
          fileSize: 350000,
          uploadedAt: '2026-02-18T16:45:00.000Z'
        }
      }
    },
    createdAt: '2026-02-18T16:45:00.000Z',
    updatedAt: '2026-02-18T16:45:00.000Z'
  },
  {
    id: 'bp_sup_3',
    type: 'Supplier',
    name: 'شرکت بازرگانی کیمیا فارمد',
    country: 'ایران',
    city: 'تهران',
    address: 'خیابان ولیعصر، بالاتر از ظفر، پلاک ۱۲',
    email: 'info@kimya-pharma.ir',
    contactPerson: 'دکتر حسینی',
    phone: '021-88776655',
    website: 'http://www.kimya-pharma.ir',
    manufacturerId: 'bp_mfg_4',
    status: 'Active',
    evaluation: {
      totalScore: 70,
      grade: 'B',
      status: 'Approved with Monitoring',
      updatedAt: '2026-02-25T09:10:00.000Z',
      documents: {
        manufacturerLetter: {
          key: 'manufacturerLetter',
          nameFa: 'نامه‌نگاری و معرفی‌نامه سازنده',
          nameEn: 'Manufacturer Letter',
          status: 'Approved',
          score: 20,
          fileName: 'CinnaGen_KimyaPharma_Agency.pdf',
          fileSize: 1100000,
          uploadedAt: '2026-02-25T09:10:00.000Z'
        },
        authorizedSignatory: {
          key: 'authorizedSignatory',
          nameFa: 'صاحبان امضای مجاز',
          nameEn: 'Authorized Signatory',
          status: 'Approved',
          score: 20,
          fileName: 'Roozname_Rasmi_Kimya.pdf',
          fileSize: 850000,
          uploadedAt: '2026-02-25T09:10:00.000Z'
        },
        businessLicense: {
          key: 'businessLicense',
          nameFa: 'پروانه / مجوز فعالیت قانونی',
          nameEn: 'Business License',
          status: 'Permit Approval',
          score: 10,
          fileName: 'Mojavez_Gharantineh.pdf',
          fileSize: 950000,
          uploadedAt: '2026-02-25T09:10:00.000Z'
        },
        officialEnglishTranslation: {
          key: 'officialEnglishTranslation',
          nameFa: 'ترجمه رسمی انگلیسی مدارک',
          nameEn: 'Official English Translation',
          status: 'Permit Approval',
          score: 10,
          fileName: 'Official_Trans_Kimya.pdf',
          fileSize: 400000,
          uploadedAt: '2026-02-25T09:10:00.000Z'
        },
        legalization: {
          key: 'legalization',
          nameFa: 'تاییدیه سفارت / کنسولی (لگالایزیشن)',
          nameEn: 'Legalization',
          status: 'Permit Approval',
          score: 10
        }
      }
    },
    createdAt: '2026-02-25T09:10:00.000Z',
    updatedAt: '2026-02-25T09:10:00.000Z'
  }
];
