export type Category = 'foreign' | 'domestic' | 'veterinary' | 'packaging' | 'sample' | 'blacklist';
export type Status = 'approved' | 'conditional' | 'rejected' | 'new';
export type Grade = 'A' | 'B' | 'C' | 'black list' | 'rejected' | null | string;

export type Role = 'admin' | 'lab' | 'commercial' | 'qa' | 'planning' | 'finance';
export interface User {
  username: string;
  role: Role;
  name: string;
  /** Effective permissions from the server: the per-user overrides when set,
   *  otherwise the role's template. Absent for sessions restored from an older
   *  cache, in which case the role template applies. */
  permissions?: string[];
  mustChangePassword?: boolean;
}

export interface AnalysisRecord {
  id: string;
  date: string;
  qcCode: string;
  decision: 'Pass' | 'Reject' | 'Approved Conditional';
  deviationReason: 'None' | 'NCR' | 'Deviation' | 'OOS' | 'CAPA' | 'OOT' | 'Complaint' | 'Other';
  comments: string;
  recordedBy: string;
}

export interface Scores {
  commercial: number;
  qa: number;
  planning: number;
  finance: number;
}

export interface ActivityLog {
  id: string;
  action: string;
  date: string;
  user: string;
}

export interface RiskAssessmentData {
  materialCriticality: number; // 1-5
  detectability: number; // 1-5
  probability: number; // 1-5
  sps: number;
  riskScore: number;
  sri: number;
  riskLevel: 'Low' | 'Medium' | 'High';
  date: string;
  evaluator: string;
}

export interface Vendor {
  id: string;
  category: Category;
  materialId?: string;
  material: string;
  materialEn: string;
  cas: string;
  irc: string;
  name: string;
  nameEn: string;
  country: string;
  grade: Grade;
  status: Status;
  scores: Scores | null;
  rawScores?: Record<string, Record<string, number>>;
  lastAudit: string | null;
  ircExpiryDate?: string | null;
  rejectionReasons: string[] | null;
  contactInfo?: string;
  registrationDate?: string;
  isSample?: boolean;
  initialSampleStatus?: 'approved' | 'conditional' | 'rejected' | string;
  activityLogs?: ActivityLog[];
  reasonForChange?: string;
  riskAssessment?: RiskAssessmentData | null;
  analysisRecords?: AnalysisRecord[];
  manufacturerId?: string | null;
  supplierId?: string | null;
}

export type MaterialRole = 'API' | 'Intermediate' | 'Excipient' | 'Solvent' | 'Reagent / Reactant' | 'Packaging Item' | 'Other';
export type Pharmacopoeia = 'USP' | 'EP' | 'BP' | 'JP' | 'IP' | 'Ph. Eur.' | 'ChP' | 'In-house' | 'Other';

export interface Material {
  id: string;
  nameFa: string;
  nameEn: string;
  iupac?: string;
  cas: string;
  role: MaterialRole;
  finalProduct: string;
  finalProductEn: string;
  pharmacopoeia: Pharmacopoeia;
  specificationFile?: string;
  standardNameFa: string;
  standardNameEn: string;
  irc?: string;
  ircReceiveDate?: string;
  ircExpiryDate?: string;
  createdAt: string;
}

export type BusinessPartnerType = 'Manufacturer' | 'Supplier';

export type SOPDocumentKey = 
  | 'manufacturerLetter' 
  | 'authorizedSignatory' 
  | 'businessLicense' 
  | 'officialEnglishTranslation' 
  | 'legalization';

export type SOPDocumentStatus = 'Approved' | 'Permit Approval' | 'Expired' | 'Not Submitted';

export interface SOPDocumentEval {
  key: SOPDocumentKey;
  nameFa: string;
  nameEn: string;
  status: SOPDocumentStatus | null;
  score: number;
  fileName?: string;
  fileDataUrl?: string;
  fileSize?: number;
  uploadedAt?: string;
}

// Grades produced by calculateGradeAndStatus (rubric: 80/60/40/30).
export type SOPGrade = 'A' | 'B' | 'C' | 'Pending Review' | 'Blacklist' | 'Not Evaluated';
export type SOPSupplierStatus =
  | 'Approved Supplier'
  | 'Approved with Monitoring'
  | 'Conditional Supplier'
  | 'Pending Review'
  | 'Blacklist'
  | 'Not Evaluated';

export interface SupplierEvaluation {
  documents: Record<SOPDocumentKey, SOPDocumentEval>;
  totalScore: number;
  grade: SOPGrade;
  status: SOPSupplierStatus;
  updatedAt?: string;
  updatedBy?: string;
}

export interface BusinessPartner {
  id: string;
  type: BusinessPartnerType;
  name: string;
  nameEn?: string;
  country: string;
  city?: string;
  address?: string;
  email?: string;
  contactPerson?: string;
  phone?: string;
  website?: string;
  manufacturerId?: string; // Required when type === 'Supplier'
  status: 'Active' | 'Inactive' | 'Blacklisted';
  evaluation?: SupplierEvaluation;
  createdAt: string;
  updatedAt: string;
}
