// Client-side audit trail for local/demo mode (no backend). Records are stored
// in localStorage using the SAME field names the backend /api/audit-logs returns,
// so AuditTrailView's existing mapper consumes them unchanged.

const KEY = 'app_audit_log';
const MAX_RECORDS = 500;

export interface LocalAuditInput {
  user?: string;
  role?: string;
  module: string;
  action: string;
  entityType?: string;
  entityName?: string;
  severity?: 'Info' | 'Warning' | 'Critical';
  description?: string;
  before?: any;
  after?: any;
  reason?: string;
}

export function readLocalAudit(): any[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function appendLocalAudit(input: LocalAuditInput): void {
  try {
    const now = new Date();
    const record = {
      id: `LOCAL-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now.toISOString(),
      userName: input.user || 'کاربر آزمایشی',
      userId: input.user || 'demo',
      role: input.role || 'admin',
      module: input.module,
      action: input.action,
      entityType: input.entityType || input.module,
      entityName: input.entityName || 'مشخصات',
      severity: input.severity || 'Info',
      description: input.description || '',
      beforeData: input.before ?? null,
      afterData: input.after ?? null,
      reasonForChange: input.reason || 'ثبت محلی (حالت آزمایشی)',
      correlationId: 'LOCAL',
      eventType: input.module,
      ipAddress: 'local',
      userAgent: 'Local Demo Mode',
    };
    const arr = readLocalAudit();
    arr.unshift(record);
    localStorage.setItem(KEY, JSON.stringify(arr.slice(0, MAX_RECORDS)));
  } catch (err) {
    console.error('Failed to append local audit record:', err);
  }
}
