import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  Search, Filter, SlidersHorizontal, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, X, Eye, 
  Clock, ShieldAlert, CheckCircle, AlertTriangle, FileText, 
  Activity, User as UserIcon, HelpCircle, Layers, ClipboardList,
  RotateCcw, Calendar, Key, AlertCircle, Loader2, FlaskConical,
  Calculator, Award, TrendingUp, Cpu
} from 'lucide-react';
import jalaali from 'jalaali-js';
import { Button } from './ui/button';
import { FormModal } from './FormModal';
import { Pagination } from './Pagination';
import { ShamsiDatePicker } from './ShamsiDatePicker';
import {
  AUDIT_ACTION_LABELS, AUDIT_EVENT_GROUPS, AUDIT_MODULE_LABELS, severityMatches,
} from '../utils/auditTaxonomy';
import { authFetch, isLocalMode } from '../services/authFetch';
import { EntityName } from './EntityName';
import { readLocalAudit } from '../services/localAudit';
import { Input, inputBaseClass } from './ui/input';
import { cn } from '../lib/utils';

export interface AuditLog {
  id: string;
  date: string;
  time: string;
  user: string;
  role: string;
  module: string;
  action: 'Create' | 'Update' | 'Delete' | 'Reject' | 'Login' | 'LOGIN' | 'LOGOUT' | 'FAILED_LOGIN' | 'CREATE_USER' | 'UPDATE_USER' | 'DELETE_USER' | 'ROLE_CHANGE' | 'PERMISSION_CHANGE' | string;
  recordName: string;
  severity: 'Info' | 'Warning' | 'Critical' | string;
  description: string;
  before: Record<string, any> | string | null;
  after: Record<string, any> | string | null;
  reason: string;
  correlationId: string;
  entityType?: string;
  entityId?: string;
  eventType?: string;
  ipAddress?: string;
  userAgent?: string;
}

// Persian helper maps
const roleLabels: Record<string, string> = {
  admin: 'مدیر سیستم',
  qa: 'واحد کیفیت QA',
  lab: 'مسئول آزمایشگاه',
  commercial: 'واحد بازرگانی',
  planning: 'برنامه‌ریزی و انبار',
  finance: 'واحد مالی',
  guest: 'کاربر ناشناس / مهمان'
};

const actionLabels: Record<string, { label: string; bg: string; text: string }> = {
  Create: { label: 'ایجاد', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900', text: 'text-emerald-700' },
  Update: { label: 'ویرایش', bg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-900', text: 'text-blue-700' },
  Delete: { label: 'حذف', bg: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-900', text: 'text-rose-700' },
  Reject: { label: 'مردودسازی', bg: 'bg-red-50 text-red-700 border-red-200', text: 'text-red-700' },
  'System Update': { label: 'تغییر خودکار سیستم', bg: 'bg-purple-50 text-purple-700 border-purple-200', text: 'text-purple-700' },
  Restore: { label: 'بازگردانی', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:border-indigo-900', text: 'text-indigo-700' },
  Login: { label: 'ورود به سیستم', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900', text: 'text-emerald-700' },
  LOGIN: { label: 'ورود موفق', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-900', text: 'text-emerald-700' },
  LOGOUT: { label: 'خروج از سیستم', bg: 'bg-muted text-foreground border-border', text: 'text-foreground' },
  FAILED_LOGIN: { label: 'ورود ناموفق (امنیتی)', bg: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-900', text: 'text-rose-700' },
  CREATE_USER: { label: 'ایجاد کاربر', bg: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-200 dark:border-teal-900', text: 'text-teal-700' },
  UPDATE_USER: { label: 'ویرایش کاربر', bg: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-900', text: 'text-blue-700' },
  DELETE_USER: { label: 'حذف کاربر', bg: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-900', text: 'text-rose-700' },
  ROLE_CHANGE: { label: 'تغییر سمت (Role)', bg: 'bg-purple-50 text-purple-700 border-purple-200', text: 'text-purple-700' },
  PERMISSION_CHANGE: { label: 'تغییر دسترسی', bg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900', text: 'text-amber-700' }
};

/**
 * A sortable column header: a real button, with the direction announced.
 *
 * The old headers were `<button>`s inside a plain `<th>` with no `aria-sort`,
 * and they set state the query never sent — see AuditService.orderFor.
 */
const SortHeader: React.FC<{
  field: 'date' | 'user';
  label: string;
  width: string;
  sortField: 'date' | 'user';
  sortDirection: 'asc' | 'desc';
  onSort: (f: 'date' | 'user') => void;
}> = ({ field, label, width, sortField, sortDirection, onSort }) => {
  const active = sortField === field;
  const Icon = !active ? ArrowUpDown : sortDirection === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      style={{ width }}
      className={`p-0 ${active ? 'text-foreground' : ''}`}
      aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        title={`مرتب‌سازی بر اساس ${label}`}
        className="w-full py-3 px-4 flex items-center gap-1.5 font-bold hover:bg-accent hover:text-foreground transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <span>{label}</span>
        <Icon className={`w-3 h-3 shrink-0 ${active ? 'text-foreground' : 'text-muted-foreground'}`} />
      </button>
    </th>
  );
};

const severityLabels: Record<string, { label: string; bg: string; text: string; icon: any }> = {
  Info: { label: 'عادی (Info)', bg: 'bg-muted text-foreground border-border', text: 'text-foreground', icon: InfoIcon },
  Warning: { label: 'هشدار (Warning)', bg: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-900', text: 'text-amber-700', icon: AlertTriangle },
  Critical: { label: 'بحرانی (Critical)', bg: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-900', text: 'text-rose-700', icon: ShieldAlert }
};

function InfoIcon(props: any) {
  return <CheckCircle className="w-3.5 h-3.5" {...props} />;
}

// Persian labels for common audit field keys (fallback: raw key).
const fieldKeyLabels: Record<string, string> = {
  status: 'وضعیت', grade: 'گرید', name: 'نام', nameEn: 'نام لاتین', country: 'کشور',
  material: 'ماده', materialEn: 'ماده (لاتین)', cas: 'CAS', irc: 'IRC', category: 'دسته',
  contactInfo: 'اطلاعات تماس', totalSPS: 'امتیاز SPS', scores: 'نمرات', riskLevel: 'سطح ریسک',
  riskScore: 'RPN', sri: 'SRI', decision: 'تصمیم', deviationReason: 'انحراف', qcCode: 'کد QC',
  evaluator: 'ارزیاب', role: 'نقش', username: 'نام کاربری', mustChangePassword: 'اجبار تغییر رمز',
  initialSampleStatus: 'وضعیت اولیهٔ نمونه', rejectionReasons: 'دلایل رد', totalScore: 'امتیاز کل',
  // Source selection (PUT /api/source-selections) and risk assessment.
  vendorId: 'سورس منتخب', materialKey: 'ماده', reason: 'دلیل انتخاب', decidedBy: 'تصمیم‌گیرنده',
  rpn: 'RPN', SRI: 'SRI', materialCriticality: 'بحرانیت ماده', detectability: 'قابلیت تشخیص',
  probability: 'احتمال وقوع', sps: 'امتیاز SPS', date: 'تاریخ',
  commercialScore: 'امتیاز بازرگانی', qualityScore: 'امتیاز کیفی',
  planningScore: 'امتیاز برنامه‌ریزی', financeScore: 'امتیاز مالی',
};

/**
 * Jalali `YYYY/MM/DD` → an ISO instant the API can compare against.
 * The date boxes used to be free text whose Persian value went straight into
 * `new Date()` on the server, producing `Invalid Date`; the range filter has
 * therefore never worked. `end` takes the last millisecond of the day so that
 * "تا ۱۴۰۵/۰۵/۱۵" includes everything logged on the 15th.
 */
function jalaliToIso(jalaliStr: string, edge: 'start' | 'end'): string {
  const [jy, jm, jd] = jalaliStr.split('/').map(n => parseInt(n, 10));
  if (!jy || !jm || !jd) return '';
  try {
    const { gy, gm, gd } = jalaali.toGregorian(jy, jm, jd);
    const d = edge === 'start'
      ? new Date(gy, gm - 1, gd, 0, 0, 0, 0)
      : new Date(gy, gm - 1, gd, 23, 59, 59, 999);
    return d.toISOString();
  } catch {
    return '';
  }
}

const fmtVal = (v: any): string => {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return `${v.length} مورد`;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/**
 * Metadata that describes the event rather than the change. It lives in its own
 * columns now, but records written before that still carry it inside
 * `after_data`, where it would otherwise read as a set of added fields.
 */
const META_KEYS = new Set(['ipAddress', 'userAgent', 'eventType', 'ip', 'device']);

const isPlainObject = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Whether a record documents an action rather than a data change.
 *
 * A sign-in has no "before": its `afterData` describes who signed in, so the
 * diff rendered the actor's name, role and username as three "added fields" —
 * a change list for something that changed nothing. These records get a plain
 * sentence instead, and their details stay in the technical section.
 */
const AUTH_ACTIONS = new Set(['LOGIN', 'Login', 'LOGOUT', 'Logout', 'FAILED_LOGIN']);
const isNonDataEvent = (log: { action?: string; module?: string; before?: any }) =>
  !log.before && (AUTH_ACTIONS.has(log.action || '') || log.module === 'احراز هویت');

export interface FieldDiffRow {
  key: string;
  label: string;
  from: string;
  to: string;
  kind: 'added' | 'removed' | 'changed';
}

/**
 * The fields that differ between two audit snapshots.
 *
 * Nested objects are walked rather than stringified: a score record holds the
 * four department scores in one object, and comparing them as JSON turned a
 * single changed number into one unreadable line of `{"commercial":80,…}` →
 * `{"commercial":90,…}`. Walking names the field that actually moved.
 */
export function computeFieldDiff(before: any, after: any, prefix = ''): FieldDiffRow[] {
  const bef = isPlainObject(before) ? before : {};
  const aft = isPlainObject(after) ? after : {};
  const keys = Array.from(new Set([...Object.keys(bef), ...Object.keys(aft)]));
  const rows: FieldDiffRow[] = [];

  for (const k of keys) {
    if (!prefix && META_KEYS.has(k)) continue;

    const bv = bef[k];
    const av = aft[k];
    if (isPlainObject(bv) || isPlainObject(av)) {
      rows.push(...computeFieldDiff(bv, av, prefix ? `${prefix}.${k}` : k));
      continue;
    }

    const from = fmtVal(bv);
    const to = fmtVal(av);
    if (from === to) continue;

    const path = prefix ? `${prefix}.${k}` : k;
    const inBef = k in bef && bv !== null && bv !== undefined && bv !== '';
    const inAft = k in aft && av !== null && av !== undefined && av !== '';
    rows.push({
      key: path,
      // A nested field is labelled by its own name, with the parent kept for
      // context when there is no Persian label for it.
      label: fieldKeyLabels[k] || (prefix ? `${fieldKeyLabels[prefix] || prefix} · ${k}` : k),
      from,
      to,
      kind: !inBef ? 'added' : !inAft ? 'removed' : 'changed',
    });
  }
  return rows;
}

export const AuditTrailView: React.FC = () => {
  // Navigation & view states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  
  // Filter States
  const [filterUser, setFilterUser] = useState('all');
  const [filterModule, setFilterModule] = useState('all');
  const [filterGroup, setFilterGroup] = useState('all');
  const [filterAction, setFilterAction] = useState('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  // Kept as Jalali `YYYY/MM/DD` — what the user reads — and converted to a real
  // instant only on the way to the API.
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const advancedFilterCount = [filterUser, filterModule, filterGroup, filterAction, filterSeverity].filter(v => v !== 'all').length + (startDate ? 1 : 0) + (endDate ? 1 : 0);

  // Sorting States
  const [sortField, setSortField] = useState<'date' | 'user'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // Quick Action selection helper
  const [quickSeverityFilter, setQuickSeverityFilter] = useState<string | null>(null);
  const [quickCategoryFilter, setQuickCategoryFilter] = useState<string>('all');

  // Backend integration states
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [apiUsers, setApiUsers] = useState<string[]>([]);
  const [apiModules, setApiModules] = useState<string[]>([]);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [stats, setStats] = useState({
    total: 0,
    critical: 0,
    warning: 0,
    activeUsers: 0,
    lastUpdated: "-"
  });

  // Dynamic filter lists for select options.
  // Only users that really appear in the log: offering demo names guaranteed an
  // empty result, since no such record exists in the database.
  const uniqueUsers = useMemo(() => Array.from(new Set(apiUsers)), [apiUsers]);

  /**
   * The module options are the values `server.ts` actually writes (see
   * auditTaxonomy.ts), plus anything the live log contains that the map does
   * not know about yet — so a new call site shows up as its raw value rather
   * than disappearing from the filter.
   */
  const moduleOptions = useMemo(() => {
    const known = Object.keys(AUDIT_MODULE_LABELS);
    const extras = apiModules.filter(m => !AUDIT_MODULE_LABELS[m]);
    return [...known, ...extras].map(value => ({ value, label: AUDIT_MODULE_LABELS[value] || value }));
  }, [apiModules]);

  // Fetch real logs from backend
  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const activeSev = quickSeverityFilter || filterSeverity;

      // Local/demo mode: read the client-side audit store instead of the backend.
      if (isLocalMode()) {
        const mapLocal = (l: any) => {
          const d = new Date(l.timestamp);
          return {
            id: l.id,
            date: d.toLocaleDateString('fa-IR'),
            time: d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            user: l.userName || l.userId || 'سیستم',
            role: l.role || 'user',
            module: l.module,
            action: l.action,
            recordName: l.entityName || l.entityId || 'مشخصات',
            severity: l.severity === 'Critical' ? 'Critical' : l.severity === 'Warning' ? 'Warning' : 'Info',
            description: l.description || '',
            before: l.beforeData,
            after: l.afterData,
            reason: l.reasonForChange || '—',
            correlationId: l.correlationId || 'LOCAL',
            entityType: l.entityType,
            eventType: l.eventType || l.module,
            ipAddress: l.ipAddress || 'local',
            userAgent: l.userAgent || 'Local Demo Mode',
          };
        };
        const q = searchQuery.trim().toLowerCase();
        const groupModules = AUDIT_EVENT_GROUPS[filterGroup]?.modules;
        const all = readLocalAudit().map(mapLocal).filter((l: any) => {
          if (filterUser !== 'all' && l.user !== filterUser) return false;
          if (filterModule !== 'all' && l.module !== filterModule) return false;
          if (groupModules && !groupModules.includes(l.module)) return false;
          if (filterAction !== 'all' && l.action !== filterAction) return false;
          if (activeSev !== 'all' && !severityMatches(activeSev).includes(l.severity)) return false;
          if (q && !(`${l.user} ${l.module} ${l.recordName} ${l.action} ${l.description}`.toLowerCase().includes(q))) return false;
          return true;
        });
        setTotalItems(all.length);
        const ordered = [...all].sort((a: any, b: any) => {
          const dir = sortDirection === 'asc' ? 1 : -1;
          if (sortField === 'user') return dir * String(a.userName || '').localeCompare(String(b.userName || ''), 'fa');
          return dir * (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
        });
        setLogs(ordered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage));
        setIsLoading(false);
        return;
      }


      const activeSeverity = quickSeverityFilter || filterSeverity;

      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
        userId: filterUser !== 'all' ? filterUser : '',
        module: filterModule !== 'all' ? filterModule : '',
        group: filterGroup !== 'all' ? filterGroup : '',
        action: filterAction !== 'all' ? filterAction : '',
        severity: activeSeverity !== 'all' ? activeSeverity : '',
        quickFilter: quickCategoryFilter !== 'all' ? quickCategoryFilter : '',
        startDate: startDate ? jalaliToIso(startDate, 'start') : '',
        endDate: endDate ? jalaliToIso(endDate, 'end') : '',
        query: searchQuery,
        // The list is paginated server-side, so the order has to be decided
        // there too: sorting the ten rows on screen would sort the page, not
        // the log.
        sortBy: sortField,
        sortDir: sortDirection,
      });

      const response = await authFetch(`/api/audit-logs?${params.toString()}`);
      if (response.ok) {
        const result = await response.json();
        
        const formattedData = result.data.map((l: any) => {
          const d = new Date(l.timestamp || l.createdAt);
          const persianDate = d.toLocaleDateString('fa-IR');
          const persianTime = d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          
          let cleanSeverity = 'Info';
          if (l.severity === 'Critical') cleanSeverity = 'Critical';
          if (l.severity === 'Warning') cleanSeverity = 'Warning';

          return {
            id: l.id,
            date: persianDate,
            time: persianTime,
            user: l.userName || l.userId || 'سیستم',
            role: l.role || 'user',
            module: l.module,
            action: l.action,
            recordName: l.entityName || l.entityId || 'مشخصات',
            severity: cleanSeverity,
            description: l.description || '',
            before: l.beforeData,
            after: l.afterData,
            reason: l.reasonForChange || 'تایید فرآیندی',
            correlationId: l.correlationId || 'N/A',
            eventType: l.eventType || l.afterData?.eventType || l.module || 'User Activity',
            // Read from the record's own columns; the `afterData` lookups are
            // the fallback for rows written before those columns existed.
            ipAddress: l.ipAddress || l.afterData?.ipAddress || l.afterData?.ip || '—',
            userAgent: l.userAgent || l.afterData?.userAgent || l.afterData?.device || '—',
          };
        });

        setLogs(formattedData);
        setTotalItems(result.total || 0);
      }
    } catch (err) {
      console.error('Failed to fetch real audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, filterUser, filterModule, filterGroup, filterAction, filterSeverity, quickSeverityFilter, quickCategoryFilter, startDate, endDate, searchQuery, itemsPerPage, sortField, sortDirection]);

  // Fetch metrics and filters
  const fetchStatsAndFilters = useCallback(async () => {
    try {
      if (isLocalMode()) {
        const all = readLocalAudit();
        setStats({
          total: all.length,
          critical: all.filter((l: any) => l.severity === 'Critical').length,
          warning: all.filter((l: any) => l.severity === 'Warning').length,
          activeUsers: new Set(all.map((l: any) => l.userName)).size,
          lastUpdated: all[0] ? new Date(all[0].timestamp).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '—',
        });
        setApiUsers(Array.from(new Set(all.map((l: any) => l.userName).filter(Boolean))));
        setApiModules(Array.from(new Set(all.map((l: any) => l.module).filter(Boolean))));
        return;
      }
      const [statsRes, filtersRes] = await Promise.all([
        authFetch('/api/audit-logs/stats'),
        authFetch('/api/audit-logs/filters'),
      ]);

      if (statsRes.ok) {
        const statsData = await statsRes.json();
        if (statsData.total > 0) {
          setStats({
            total: statsData.total,
            critical: statsData.critical,
            warning: statsData.warning,
            activeUsers: statsData.activeUsers,
            lastUpdated: statsData.lastUpdated,
          });
        } else {
          // An empty log is a fact worth showing, not something to paper over:
          // this module is the GMP audit trail, and inventing records here — as
          // the old demo fallback did, complete with a fabricated OOS batch
          // rejection — makes them indistinguishable from real ones.
          setStats({ total: 0, critical: 0, warning: 0, activeUsers: 0, lastUpdated: '—' });
        }
      }

      if (filtersRes.ok) {
        const filtersData = await filtersRes.json();
        if (filtersData.uniqueUsers && filtersData.uniqueUsers.length > 0) {
          setApiUsers(filtersData.uniqueUsers);
        }
        if (filtersData.uniqueModules && filtersData.uniqueModules.length > 0) {
          setApiModules(filtersData.uniqueModules);
        }
      }
    } catch (err) {
      console.error('Failed to fetch stats and filters:', err);
    }
  }, []);

  // Sync log listings on filter/page updates
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Sync general options on load
  useEffect(() => {
    fetchStatsAndFilters();
  }, [fetchStatsAndFilters]);

  // Handle open drawer + async loading details
  const handleOpenDrawer = async (log: AuditLog) => {
    setSelectedLog(log);
    setIsLoadingDetail(true);
    try {
      const response = await authFetch(`/api/audit-logs/${log.id}`);
      if (response.ok) {
        const l = await response.json();
        setSelectedLog(prev => {
          if (!prev || prev.id !== log.id) return prev;
          return {
            ...prev,
            before: l.beforeData,
            after: l.afterData,
            reason: l.reasonForChange || prev.reason,
            correlationId: l.correlationId || prev.correlationId
          };
        });
      }
    } catch (err) {
      console.error('Failed to load audit record details:', err);
    } finally {
      setIsLoadingDetail(false);
    }
  };

  // Handle Sort Toggle
  const handleSort = (field: 'date' | 'user') => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

  // Clear Filters helper
  const handleResetFilters = () => {
    setSearchQuery('');
    setFilterUser('all');
    setFilterModule('all');
    setFilterGroup('all');
    setFilterAction('all');
    setFilterSeverity('all');
    setStartDate('');
    setEndDate('');
    setQuickSeverityFilter(null);
    setQuickCategoryFilter('all');
    setCurrentPage(1);
  };

  // Export ALL records matching the current filters (not just the current page).
  const [isExporting, setIsExporting] = useState(false);
  /**
   * The export used to report itself with native alert()s, which blocked the
   * page and could not be styled or laid out right-to-left. The outcome now
   * appears under the button that started it; a "nothing matched" result is a
   * finding, not a failure, so the two are told apart.
   */
  const [exportNotice, setExportNotice] = useState<{ kind: 'empty' | 'error'; text: string } | null>(null);
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const activeSev = quickSeverityFilter || filterSeverity;
      const q = searchQuery.trim().toLowerCase();
      const mapRow = (l: any) => {
        const d = new Date(l.timestamp || l.createdAt);
        return {
          date: d.toLocaleDateString('fa-IR'),
          time: d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          user: l.userName || l.userId || 'سیستم',
          role: l.role || 'user',
          module: l.module,
          action: l.action,
          recordName: l.entityName || l.entityId || 'مشخصات',
          severity: l.severity === 'Critical' ? 'Critical' : l.severity === 'Warning' ? 'Warning' : 'Info',
          description: l.description || '',
          reason: l.reasonForChange || '',
          before: l.beforeData,
          after: l.afterData,
        };
      };
      let rows: any[] = [];
      if (isLocalMode()) {
        const groupModules = AUDIT_EVENT_GROUPS[filterGroup]?.modules;
        rows = readLocalAudit().map(mapRow).filter((l: any) => {
          if (filterUser !== 'all' && l.user !== filterUser) return false;
          if (filterModule !== 'all' && l.module !== filterModule) return false;
          if (groupModules && !groupModules.includes(l.module)) return false;
          if (filterAction !== 'all' && l.action !== filterAction) return false;
          if (activeSev !== 'all' && !severityMatches(activeSev).includes(l.severity)) return false;
          if (q && !(`${l.user} ${l.module} ${l.recordName} ${l.action} ${l.description}`.toLowerCase().includes(q))) return false;
          return true;
        });
      } else {
        const params = new URLSearchParams({
          page: '1', limit: '10000',
          userId: filterUser !== 'all' ? filterUser : '',
          module: filterModule !== 'all' ? filterModule : '',
          group: filterGroup !== 'all' ? filterGroup : '',
          action: filterAction !== 'all' ? filterAction : '',
          severity: activeSev !== 'all' ? activeSev : '',
          quickFilter: quickCategoryFilter !== 'all' ? quickCategoryFilter : '',
          startDate: startDate ? jalaliToIso(startDate, 'start') : '',
          endDate: endDate ? jalaliToIso(endDate, 'end') : '',
          query: searchQuery,
        });
        const res = await authFetch(`/api/audit-logs?${params.toString()}`);
        if (res.ok) { const j = await res.json(); rows = (j.data || []).map(mapRow); }
      }
      if (rows.length === 0) {
        setExportNotice({ kind: 'empty', text: 'با فیلترهای فعلی رکوردی برای خروجی پیدا نشد.' });
        return;
      }
      // Loaded here rather than at the top of the file: the spreadsheet
      // writer is the largest dependency in the bundle and this view is not
      // an export tool until the button is pressed. The surrounding try/catch
      // already reports a failure under the button.
      const { exportAuditToExcel } = await import('../utils/excelExport');
      exportAuditToExcel(rows);
      setExportNotice(null);
    } catch (err) {
      console.error('Audit export failed:', err);
      setExportNotice({ kind: 'error', text: 'تهیهٔ خروجی Excel ناموفق بود. دوباره تلاش کنید یا با پشتیبانی تماس بگیرید.' });
    } finally {
      setIsExporting(false);
    }
  };

  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  return (
    <div className="space-y-6 text-right pb-12 w-full" dir="rtl">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-muted border border-border rounded-xl text-foreground">
              <ClipboardList className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-extrabold text-foreground tracking-tight">ردیابی تغییرات</h1>
          </div>
          <p className="text-muted-foreground text-xs">سامانه مانیتورینگ فعالیت‌های سیستم و تاریخچه تغییرات فرآیندی (GMP Compliance)</p>
        </div>

        {/* TOP METRIC CHIPS */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <Button
            variant="success"
            size="sm"
            onClick={handleExport}
            disabled={isExporting || stats.total === 0}
            className="font-bold"
          >
            {isExporting ? <Loader2 className="animate-spin" /> : <FileText />}
            خروجی Excel
          </Button>
          <div className="bg-card border border-border px-3 py-1.5 rounded-xl shadow-xs flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-2xs text-muted-foreground font-medium">کل لاگ‌ها:</span>
            <span className="text-xs font-bold font-mono text-foreground">{stats.total}</span>
          </div>
          <div className="bg-rose-50 border border-rose-200 dark:bg-rose-950/50 dark:border-rose-900 px-3 py-1.5 rounded-xl flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
            <span className="text-2xs text-rose-500 font-medium">خطای بحرانی:</span>
            <span className="text-xs font-bold font-mono text-rose-700">{stats.critical}</span>
          </div>

          {exportNotice && (
            <div
              role={exportNotice.kind === 'error' ? 'alert' : 'status'}
              className={`w-full md:w-auto flex items-start gap-2 px-3 py-1.5 rounded-xl text-2xs font-bold border ${
                exportNotice.kind === 'error'
                  ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
                  : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              <span>{exportNotice.text}</span>
            </div>
          )}
        </div>
      </div>

      {/* SEARCH AND QUICK FILTER CONTROLS */}
      <div className="bg-card border border-border/80 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Main search bar */}
          <div className="relative flex-1">
            <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-muted-foreground">
              <Search className="w-4 h-4" />
            </span>
            <Input
              type="text"
              placeholder="جستجو بر اساس نام کاربر، واحد، رکورد، فعالیت یا توضیحات..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full pr-10 pl-4 font-medium"
            />
          </div>

          {/* Quick Filter buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 shrink-0">
            <button
              onClick={() => { setQuickSeverityFilter(null); setCurrentPage(1); }}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 cursor-pointer ${
                quickSeverityFilter === null 
                  ? 'bg-foreground border-foreground text-background shadow-xs' 
                  : 'bg-card border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              همه رکوردهای لاگ
            </button>
            <button
              onClick={() => { setQuickSeverityFilter('Critical'); setCurrentPage(1); }}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 shrink-0 cursor-pointer ${
                quickSeverityFilter === 'Critical'
                  ? 'bg-rose-600 border-rose-700 text-white shadow-xs'
                  : 'bg-rose-50/50 border-rose-200/60 text-rose-700 hover:bg-rose-50 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200 dark:hover:bg-rose-950/60'
              }`}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              بحرانی (Critical)
            </button>
            <button
              onClick={() => { setQuickSeverityFilter('Warning'); setCurrentPage(1); }}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 shrink-0 cursor-pointer ${
                quickSeverityFilter === 'Warning'
                  ? 'bg-amber-500 border-amber-600 text-white shadow-xs'
                  : 'bg-amber-50/50 border-amber-200/60 text-amber-700 hover:bg-amber-50 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-200 dark:hover:bg-amber-950/60'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              هشدارها (Warning)
            </button>
            <button
              onClick={() => setShowAdvancedFilters(v => !v)}
              title="فیلترهای پیشرفته"
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 shrink-0 cursor-pointer ${
                showAdvancedFilters || advancedFilterCount > 0
                  ? 'bg-primary border-primary text-primary-foreground shadow-xs'
                  : 'bg-card border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              فیلترها
              {advancedFilterCount > 0 && (
                <span className="bg-white/25 text-white rounded-full px-1.5 text-2xs font-black">{advancedFilterCount}</span>
              )}
            </button>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={handleResetFilters}
              title="پاک کردن تمامی فیلترها"
              className="text-muted-foreground hover:text-foreground"
            >
              <RotateCcw />
            </Button>
          </div>
        </div>

        {/* DETAILED FILTERS — collapsible advanced panel */}
        {showAdvancedFilters && (
        <div className="pt-4 border-t border-border grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {/* User Filter */}
          <div className="space-y-1">
            <label className="text-muted-foreground text-2xs font-bold">فیلتر کاربر</label>
            <select
              value={filterUser}
              onChange={e => { setFilterUser(e.target.value); setCurrentPage(1); }}
              className={cn(inputBaseClass, 'w-full font-medium')}
            >
              <option value="all">همه کاربران</option>
              {uniqueUsers.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          {/* Module Filter */}
          <div className="space-y-1">
            <label className="text-muted-foreground text-2xs font-bold">فیلتر ماژول</label>
            <select
              value={filterModule}
              onChange={e => { setFilterModule(e.target.value); setCurrentPage(1); }}
              className={cn(inputBaseClass, 'w-full font-medium')}
            >
              <option value="all">همه ماژول‌ها</option>
              {moduleOptions.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          {/* Event group — a coarser grain above the module filter. */}
          <div className="space-y-1">
            <label className="text-muted-foreground text-2xs font-bold">گروه رویداد</label>
            <select
              value={filterGroup}
              onChange={e => { setFilterGroup(e.target.value); setCurrentPage(1); }}
              disabled={filterModule !== 'all'}
              title={filterModule !== 'all' ? 'وقتی یک ماژول مشخص انتخاب شده، گروه رویداد اثری ندارد.' : undefined}
              className={cn(inputBaseClass, 'w-full font-medium disabled:opacity-50')}
            >
              <option value="all">همه گروه‌ها</option>
              {Object.entries(AUDIT_EVENT_GROUPS).map(([key, g]) => (
                <option key={key} value={key}>{g.label}</option>
              ))}
            </select>
          </div>

          {/* Action Filter */}
          <div className="space-y-1">
            <label className="text-muted-foreground text-2xs font-bold">فیلتر نوع عملیات</label>
            <select
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); setCurrentPage(1); }}
              className={cn(inputBaseClass, 'w-full font-medium')}
            >
              <option value="all">همه عملیات</option>
              {Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label} ({value})</option>
              ))}
            </select>
          </div>

          {/* Severity Filter */}
          <div className="space-y-1">
            <label className="text-muted-foreground text-2xs font-bold">سطح بحرانیت (Severity)</label>
            <select
              value={filterSeverity}
              onChange={e => { setFilterSeverity(e.target.value); setQuickSeverityFilter(null); setCurrentPage(1); }}
              className={cn(inputBaseClass, 'w-full font-medium')}
            >
              <option value="all">همه سطوح</option>
              <option value="Information">عادی (Information)</option>
              <option value="Warning">هشدار (Warning)</option>
              <option value="Critical">بحرانی (Critical)</option>
            </select>
          </div>

          {/* Date range — a real Jalali picker instead of free text. */}
          <div className="space-y-1">
            <label className="text-muted-foreground text-2xs font-bold">از تاریخ</label>
            <ShamsiDatePicker
              value={startDate}
              onChange={v => { setStartDate(v); setCurrentPage(1); }}
              placeholder="انتخاب تاریخ شروع"
            />
          </div>

          <div className="space-y-1">
            <label className="text-muted-foreground text-2xs font-bold">تا تاریخ</label>
            <ShamsiDatePicker
              value={endDate}
              onChange={v => { setEndDate(v); setCurrentPage(1); }}
              placeholder="انتخاب تاریخ پایان"
            />
          </div>
        </div>
        )}
      </div>

      {/* TABLE DATA LIST CONTAINER */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-xs relative">
        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse" aria-busy={isLoading}>
            <caption className="sr-only">فهرست رویدادهای ثبت‌شده در ردیابی تغییرات</caption>
            <thead>
              <tr className="bg-muted text-muted-foreground text-xs font-bold border-b border-border">
                <SortHeader field="date" label="تاریخ و ساعت" width="16%" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <SortHeader field="user" label="کاربر" width="18%" sortField={sortField} sortDirection={sortDirection} onSort={handleSort} />
                <th className="py-3 px-4 w-[15%]">ماژول</th>
                <th className="py-3 px-4 w-[10%]">عملیات</th>
                <th className="py-3 px-4 w-[15%]">رکورد هدف</th>
                {/* Not sortable, and no longer pretending to be: the column
                    stores free text with two spellings for one level
                    (`Info`/`Information`), so a text order would read as a
                    ranking that means nothing. Severity is filtered instead —
                    the chips above the table do exactly that. */}
                <th scope="col" className="py-3 px-4 w-[13%]">سطح ریسک</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-xs font-medium text-foreground">
              {isLoading ? (
                /* Skeletons rather than a blur over the previous page: the rows
                   underneath belonged to the last query and reading them as the
                   answer to the new one is exactly the confusion to avoid. */
                [0, 1, 2, 3, 4, 5, 6].map(i => (
                  <tr key={`skeleton-${i}`} aria-hidden="true">
                    {Array.from({ length: 6 }).map((_, c) => (
                      <td key={c} className="py-3.5 px-4">
                        <div className="h-3.5 rounded bg-muted animate-pulse" style={{ width: c === 0 ? '70%' : c > 3 ? '4rem' : '55%' }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : logs.length > 0 ? (
                logs.map((log) => {
                  const actMeta = actionLabels[log.action] || { label: log.action, bg: 'bg-muted', text: 'text-foreground' };
                  const sevMeta = severityLabels[log.severity] || { label: log.severity, bg: 'bg-muted', text: 'text-foreground', icon: InfoIcon };
                  const SevIcon = sevMeta.icon;

                  return (
                    <tr 
                      key={log.id}
                      onClick={() => handleOpenDrawer(log)}
                      className="hover:bg-accent/60 transition-all duration-150 cursor-pointer group"
                    >
                      {/* Date and time used to sit shoulder to shoulder in one
                          run of digits, which read as a single number. They are
                          two facts, so they get two lines. */}
                      <td className="py-3.5 px-4 font-mono text-2xs whitespace-nowrap">
                        <span className="block text-foreground font-bold">{log.date}</span>
                        <span className="block text-muted-foreground text-2xs mt-0.5">{log.time}</span>
                      </td>
                      <td className="py-3.5 px-4 font-bold text-foreground">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                            <UserIcon className="w-3 h-3" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <span className="truncate max-w-[140px]">{log.user}</span>
                            <span className="text-muted-foreground text-2xs font-medium truncate max-w-[140px]">{roleLabels[log.role] || log.role}</span>
                          </div>
                        </div>
                      </td>
                      {/* Same label the module filter shows, so the two read alike. */}
                      <td className="py-3.5 px-4 text-muted-foreground font-semibold">{AUDIT_MODULE_LABELS[log.module] || log.module}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-md text-2xs font-bold border inline-block ${actMeta.bg}`}>
                          {actMeta.label}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-foreground font-bold max-w-[150px] xl:max-w-[18rem]">
                        <EntityName name={log.recordName} lines={2} className="font-bold whitespace-normal" />
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-2xs font-bold border inline-flex items-center gap-1 shrink-0 ${sevMeta.bg}`}>
                          <SevIcon className="w-3 h-3 shrink-0" />
                          {sevMeta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-muted-foreground font-medium">
                    {/* "No records at all" and "no records matching your
                        filters" are different situations; offering to clear
                        filters that are not set only confuses. */}
                    <div className="flex flex-col items-center gap-2">
                      <AlertCircle className="w-8 h-8 text-muted-foreground/50" />
                      {advancedFilterCount > 0 || searchQuery || quickSeverityFilter ? (
                        <>
                          <span>هیچ رکورد لاگی با مشخصات انتخابی یافت نشد.</span>
                          <Button
                            variant="link"
                            size="sm"
                            onClick={handleResetFilters}
                            className="font-bold mt-1"
                          >
                            پاک کردن فیلترها
                          </Button>
                        </>
                      ) : (
                        <>
                          <span>هنوز هیچ رویدادی در سامانه ثبت نشده است.</span>
                          <span className="text-2xs text-muted-foreground">
                            هر تغییری در سورس‌ها، مواد، شرکا و کاربران به‌صورت خودکار همین‌جا ثبت می‌شود.
                          </span>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION PANEL */}
        <div className="px-5 pb-5 pt-1 flex flex-col sm:flex-row sm:items-center gap-3">
          <label className="flex items-center gap-2 text-2xs font-bold text-muted-foreground shrink-0">
            <span>تعداد در هر صفحه</span>
            <select
              value={itemsPerPage}
              onChange={e => { setItemsPerPage(Number(e.target.value)); setCurrentPage(1); }}
              className="bg-card border border-border rounded-lg px-2 py-1 text-xs font-mono text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {totalPages > 1 && (
            <div className="flex-1 min-w-0">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                totalItems={totalItems}
                startIndex={startIndex}
                endIndex={endIndex}
                onPageChange={handlePageChange}
              />
            </div>
          )}
        </div>
      </div>

      {/* DETAIL MODAL
          This used to hand-roll its own `fixed inset-0` overlay, which put it
          in the wrong place and painted it under the app header: views render
          inside a motion.div that animates `filter`, and a non-none filter is
          both a containing block for fixed children and a stacking context, so
          `inset-0` resolved against the page box and `z-50` was trapped
          beneath the header. FormModal portals to document.body, so it escapes
          both — and brings Escape, the focus trap and the scroll lock with it. */}
      <FormModal
        open={!!selectedLog}
        onClose={() => setSelectedLog(null)}
        size="lg"
        labelledBy="audit-detail-title"
      >
        {/* Children are evaluated even while closed, so this guard is required. */}
        {selectedLog && (
            <>
              {/* Modal Header */}
            <div className="p-5 border-b border-border flex items-center justify-between bg-muted/50">
              <div className="space-y-1">
                <span className="text-2xs font-bold font-mono text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-md">
                  {selectedLog.id}
                </span>
                <h3 id="audit-detail-title" className="text-sm font-black text-foreground mt-1">جزئیات ثبت ردیابی تغییرات (Audit)</h3>
              </div>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => setSelectedLog(null)}
                className="bg-card text-muted-foreground"
              >
                <X />
              </Button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* What changed, first.
              
                  The panel used to open on ten rows of metadata — event category,
                  module, target, action, IP, device, severity — and put the before/
                  after comparison last, past three specialist cards. A reviewer opens
                  an audit record to see what changed; everything else is context for
                  that, so it now sits below, in a section that starts closed. */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black text-foreground">آنچه تغییر کرد</span>
                  {!isLoadingDetail && (() => {
                    const n = isNonDataEvent(selectedLog) ? 0 : computeFieldDiff(selectedLog.before, selectedLog.after).length;
                    return (
                      <span className="text-2xs font-bold text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-md">
                        {n > 0 ? `${n} فیلد` : 'بدون تغییر داده'}
                      </span>
                    );
                  })()}
                </div>

                {isLoadingDetail ? (
                  <div className="flex items-center gap-1.5 text-muted-foreground py-3 text-xs">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span className="italic">در حال بارگذاری تغییرات از دیتابیس...</span>
                  </div>
                ) : isNonDataEvent(selectedLog) ? (
                  <div className="text-2xs text-muted-foreground bg-muted border border-border rounded-lg p-3 leading-relaxed">
                    این رویداد تغییر داده‌ای ندارد؛ ثبت یک اقدام است (ورود/خروج). مشخصات کاربر و دستگاه در «اطلاعات فنی رویداد» آمده است.
                  </div>
                ) : (() => {
                  const diff = computeFieldDiff(selectedLog.before, selectedLog.after);
                  const bothObjects = (selectedLog.before && typeof selectedLog.before === 'object') || (selectedLog.after && typeof selectedLog.after === 'object');
                  if (diff.length === 0) {
                    return (
                      <div className="text-2xs text-muted-foreground bg-muted border border-border rounded-lg p-3 leading-relaxed">
                        {!selectedLog.before && !bothObjects
                          ? 'این رویداد تغییر داده‌ای ندارد؛ فقط ثبت یک اقدام است (مانند ورود به سامانه). شرح آن در ادامه آمده است.'
                          : !selectedLog.before && selectedLog.after ? 'رکورد جدید ایجاد شده است (مقدار قبلی وجود ندارد).'
                          : selectedLog.before && !selectedLog.after ? 'رکورد حذف شده است.'
                          : 'در این ثبت، مقدار هیچ فیلدی تغییر نکرده است.'}
                      </div>
                    );
                  }
                  const kindStyle = {
                    added: { row: 'bg-emerald-50/40 border-emerald-100 dark:bg-emerald-950/30 dark:border-emerald-900', tag: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/70 dark:text-emerald-200', label: 'افزوده' },
                    removed: { row: 'bg-rose-50/40 border-rose-100 dark:bg-rose-950/30 dark:border-rose-900', tag: 'bg-rose-100 text-rose-700 dark:bg-rose-900/70 dark:text-rose-200', label: 'حذف' },
                    changed: { row: 'bg-amber-50/40 border-amber-100 dark:bg-amber-950/30 dark:border-amber-900', tag: 'bg-amber-100 text-amber-700 dark:bg-amber-900/70 dark:text-amber-200', label: 'تغییر' },
                  } as const;
                  return (
                    <div className="space-y-1.5">
                      {diff.map(d => {
                        const s = kindStyle[d.kind];
                        return (
                          <div key={d.key} className={`rounded-lg border p-2.5 ${s.row}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-2xs font-bold text-foreground">{d.label}</span>
                              <span className={`text-2xs font-bold px-1.5 py-0.5 rounded ${s.tag}`}>{s.label}</span>
                            </div>
                            <div className="flex items-center gap-2 text-2xs font-mono" dir="ltr">
                              <span className="flex-1 text-rose-700 bg-rose-50/70 dark:text-rose-200 dark:bg-rose-950/50 rounded px-2 py-1 line-through decoration-rose-300 dark:decoration-rose-700 break-all">{d.from}</span>
                              <span className="text-muted-foreground shrink-0">→</span>
                              <span className="flex-1 text-emerald-700 bg-emerald-50/70 dark:text-emerald-200 dark:bg-emerald-950/50 rounded px-2 py-1 font-bold break-all">{d.to}</span>
                            </div>
                          </div>
                        );
                      })}
                      {/* Raw JSON fallback for full traceability */}
                      <details className="mt-2">
                        <summary className="text-2xs text-muted-foreground cursor-pointer hover:text-muted-foreground select-none">نمایش داده خام JSON (before / after)</summary>
                        <div className="grid grid-cols-1 gap-2 mt-2" dir="ltr">
                          <pre className="whitespace-pre-wrap font-mono text-2xs text-rose-800 bg-rose-50/50 border border-rose-100 p-2 rounded-lg overflow-x-auto">{selectedLog.before ? (typeof selectedLog.before === 'object' ? JSON.stringify(selectedLog.before, null, 2) : String(selectedLog.before)) : 'null'}</pre>
                          <pre className="whitespace-pre-wrap font-mono text-2xs text-emerald-800 bg-emerald-50/50 border border-emerald-100 p-2 rounded-lg overflow-x-auto">{selectedLog.after ? (typeof selectedLog.after === 'object' ? JSON.stringify(selectedLog.after, null, 2) : String(selectedLog.after)) : 'null'}</pre>
                        </div>
                      </details>
                    </div>
                  );
                })()}
              </div>
              {/* Description box */}
              <div className="space-y-1.5">
                <span className="text-2xs font-bold text-muted-foreground block">شرح فعالیت انجام شده (GMP Note):</span>
                <div className="bg-amber-50/40 border border-amber-200/50 dark:bg-amber-950/30 dark:border-amber-900 p-3 rounded-xl text-foreground text-xs leading-relaxed font-medium">
                  {selectedLog.description}
                </div>
              </div>

              {/* Reason for Change (GMP Necessity) */}
              <div className="space-y-1.5">
                <span className="text-2xs font-bold text-muted-foreground block">دلیل رسمی تغییرات (Change Rationale):</span>
                <div className="bg-muted border border-border p-3 rounded-xl text-foreground text-xs leading-relaxed font-medium">
                  {selectedLog.reason}
                </div>
              </div>


              {/* Context, folded away: the same facts, one click from the change. */}
              <details className="group border border-border rounded-xl bg-muted/30">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-2xs font-bold text-muted-foreground hover:text-foreground flex items-center gap-2">
                  <ChevronLeft className="w-3.5 h-3.5 shrink-0 transition-transform group-open:-rotate-90" />
                  <span>اطلاعات فنی رویداد (کاربر، ماژول، دستگاه و جزئیات تخصصی)</span>
                </summary>
                <div className="p-4 pt-0 space-y-5">
                {/* Core Information Cards */}
                <div className="grid grid-cols-2 gap-3.5 bg-muted p-4 rounded-xl border border-border">
                  <div className="space-y-0.5">
                    <span className="text-2xs text-muted-foreground font-bold block">کاربر ثبت‌کننده:</span>
                    <span className="text-xs font-bold text-foreground">{selectedLog.user}</span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-2xs text-muted-foreground font-bold block">سمت سازمانی:</span>
                    <span className="text-xs font-bold text-muted-foreground">{roleLabels[selectedLog.role] || selectedLog.role}</span>
                  </div>
                  <div className="space-y-0.5 pt-2 border-t border-border/50">
                    <span className="text-2xs text-muted-foreground font-bold block">تاریخ و ساعت:</span>
                    <span className="text-xs font-bold text-foreground font-mono">{selectedLog.date} - {selectedLog.time}</span>
                  </div>
                  <div className="space-y-0.5 pt-2 border-t border-border/50">
                    <span className="text-2xs text-muted-foreground font-bold block">شناسه همبستگی (Correlation):</span>
                    <span className="text-xs font-mono font-bold text-muted-foreground">{selectedLog.correlationId}</span>
                  </div>
                </div>

                {/* Scope cards */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-bold">گروه رویداد (Event Category):</span>
                    <span className="font-bold bg-cyan-50 text-cyan-800 border border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-200 dark:border-cyan-900 px-2 py-0.5 rounded-md">
                      {selectedLog.eventType || 'User Activity'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-bold">ماژول مربوطه:</span>
                    <span className="font-bold text-foreground bg-muted px-2 py-0.5 rounded-md">{AUDIT_MODULE_LABELS[selectedLog.module] || selectedLog.module}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-bold">عنوان هدف:</span>
                    <span className="font-bold text-foreground">{selectedLog.recordName}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-bold">نوع اکشن:</span>
                    <span className={`px-2 py-0.5 rounded-md text-2xs font-bold border ${actionLabels[selectedLog.action]?.bg || 'bg-muted text-foreground'}`}>
                      {actionLabels[selectedLog.action]?.label || selectedLog.action}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-bold">آدرس IP کاربر:</span>
                    <span className="font-mono font-bold text-foreground bg-muted px-2 py-0.5 rounded-md dir-ltr">{selectedLog.ipAddress || '127.0.0.1'}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-bold">دستگاه / مرورگر:</span>
                    <span className="font-mono text-2xs font-semibold text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-md truncate max-w-[200px]" title={selectedLog.userAgent}>
                      {selectedLog.userAgent || 'Chrome / Windows'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground font-bold">سطح بحرانیت:</span>
                    <span className={`px-2 py-0.5 rounded-full text-2xs font-bold border inline-flex items-center gap-1 ${severityLabels[selectedLog.severity]?.bg || 'bg-muted text-foreground'}`}>
                      <CheckCircle className="w-3 h-3" />
                      {severityLabels[selectedLog.severity]?.label || selectedLog.severity}
                    </span>
                  </div>
                </div>

                {/* STRUCTURED LAB / SAMPLE SUMMARY CARD */}
                {(() => {
                  const bef = selectedLog.before && typeof selectedLog.before === 'object' ? selectedLog.before : {};
                  const aft = selectedLog.after && typeof selectedLog.after === 'object' ? selectedLog.after : {};
                
                  const sourceName = aft.sourceName || bef.sourceName || selectedLog.recordName;
                  const material = aft.material || bef.material;
                  const testName = aft.testName || bef.testName || (selectedLog.recordName?.includes('QC') ? selectedLog.recordName : null);
                  const beforeResult = bef.testResult || bef.comments;
                  const afterResult = aft.testResult || aft.comments;
                  const beforeStatus = bef.decision || bef.status || bef.effectiveSampleStatus || bef.previousStatus;
                  const afterStatus = aft.decision || aft.status || aft.effectiveSampleStatus || aft.newStatus;
                  const prevCounters = bef.previousCounters || { reject: bef.previousRejectCount, pass: bef.previousPassCount, conditional: bef.previousConditionalCount };
                  const newCounters = aft.newCounters || { reject: aft.newRejectCount, pass: aft.newPassCount, conditional: aft.newConditionalCount };

                  const hasLabSummary = testName || beforeResult || afterResult || beforeStatus || afterStatus || prevCounters.reject !== undefined || newCounters.reject !== undefined;

                  if (!hasLabSummary) return null;

                  return (
                    <div className="bg-foreground text-background p-4 rounded-xl space-y-3 border border-border shadow-xs">
                      <div className="flex items-center justify-between pb-2 border-b border-background/20">
                        <div className="flex items-center gap-2">
                          <FlaskConical className="w-4 h-4 text-blue-400" />
                          <span className="text-xs font-bold">جزئیات اختصاصی آزمایشگاه و وضعیت نمونه</span>
                        </div>
                        <span className="text-2xs bg-background/10 text-background/80 px-2 py-0.5 rounded-full font-mono">
                          {selectedLog.module} / {selectedLog.recordName}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground text-2xs block">نام سورس / شرکت:</span>
                          <span className="font-bold text-white">{sourceName || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-2xs block">ماده اولیه (Material):</span>
                          <span className="font-bold text-white">{material || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-2xs block">کد آزمون / Test Name:</span>
                          <span className="font-mono text-amber-300 font-bold">{testName || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-2xs block">کاربر ثبت کننده:</span>
                          <span className="font-medium">{selectedLog.user}</span>
                        </div>
                      </div>

                      {(beforeResult || afterResult) && (
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-background/20 text-xs">
                          <div>
                            <span className="text-rose-300 text-2xs block">نتیجه آزمایش (Before):</span>
                            <span className="font-mono text-rose-200 bg-rose-950/40 px-2 py-1 rounded block mt-0.5 text-2xs">{beforeResult || 'نامشخص / تعریف اولیه'}</span>
                          </div>
                          <div>
                            <span className="text-emerald-300 text-2xs block">نتیجه آزمایش (After):</span>
                            <span className="font-mono text-emerald-200 bg-emerald-950/40 px-2 py-1 rounded block mt-0.5 text-2xs">{afterResult || 'حذف شده یا بدون تغییر'}</span>
                          </div>
                        </div>
                      )}

                      {(beforeStatus || afterStatus) && (
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-background/20 text-xs">
                          <div>
                            <span className="text-muted-foreground text-2xs block">وضعیت/تصمیم (Before):</span>
                            <span className="font-bold text-rose-300">{beforeStatus || 'N/A'}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground text-2xs block">وضعیت/تصمیم (After):</span>
                            <span className="font-bold text-emerald-300">{afterStatus || 'N/A'}</span>
                          </div>
                        </div>
                      )}

                      {(prevCounters.reject !== undefined || newCounters.reject !== undefined) && (
                        <div className="pt-2 border-t border-background/20 text-2xs space-y-1">
                          <span className="text-muted-foreground text-2xs block">شمارنده‌های نتایج آزمایشگاه (Laboratory Counters):</span>
                          <div className="flex items-center justify-between bg-background/10 p-2 rounded-lg text-background/80 font-mono text-2xs">
                            <div>
                              <span className="text-muted-foreground">قبلی: </span>
                              <span className="text-emerald-400">Pass: {prevCounters.pass ?? 0}</span> | <span className="text-amber-400">Cond: {prevCounters.conditional ?? 0}</span> | <span className="text-rose-400">Reject: {prevCounters.reject ?? 0}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">جدید: </span>
                              <span className="text-emerald-400 font-bold">Pass: {newCounters.pass ?? 0}</span> | <span className="text-amber-400 font-bold">Cond: {newCounters.conditional ?? 0}</span> | <span className="text-rose-400 font-bold">Reject: {newCounters.reject ?? 0}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* STRUCTURED RISK / FMEA SUMMARY CARD */}
                {(() => {
                  const bef = selectedLog.before && typeof selectedLog.before === 'object' ? selectedLog.before : {};
                  const aft = selectedLog.after && typeof selectedLog.after === 'object' ? selectedLog.after : {};
                
                  const isRiskOrFmea = 
                    selectedLog.module === 'Risk Assessment' || 
                    selectedLog.entityType === 'Risk Assessment' || 
                    selectedLog.entityType === 'FMEA' ||
                    (selectedLog.description && (selectedLog.description.includes('FMEA') || selectedLog.description.includes('ریسک') || selectedLog.description.includes('RPN')));

                  if (!isRiskOrFmea) return null;

                  const supplier = aft.supplier || bef.supplier || selectedLog.recordName;
                  const material = aft.material || bef.material;
                  const prevRPN = bef.rpn ?? bef.previousRPN ?? (bef.severity && bef.occurrence && bef.detectability ? bef.severity * bef.occurrence * bef.detectability : null);
                  const newRPN = aft.rpn ?? aft.newRPN ?? (aft.severity && aft.occurrence && aft.detectability ? aft.severity * aft.occurrence * aft.detectability : null);
                  const prevSRI = bef.sri ?? bef.previousSRI;
                  const newSRI = aft.sri ?? aft.newSRI;
                  const prevLevel = bef.riskLevel ?? bef.previousRiskLevel;
                  const newLevel = aft.riskLevel ?? aft.newRiskLevel;

                  const prevSev = bef.severity ?? bef.previousSeverity;
                  const newSev = aft.severity ?? aft.newSeverity;
                  const prevOcc = bef.occurrence ?? bef.previousOccurrence;
                  const newOcc = aft.occurrence ?? aft.newOccurrence;
                  const prevDet = bef.detectability ?? bef.previousDetectability;
                  const newDet = aft.detectability ?? aft.newDetectability;

                  return (
                    <div className="bg-foreground text-background p-4 rounded-xl space-y-3 border border-border shadow-xs">
                      <div className="flex items-center justify-between pb-2 border-b border-background/20">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-400" />
                          <span className="text-xs font-bold">جزئیات ارزیابی ریسک و FMEA</span>
                        </div>
                        <span className="text-2xs bg-amber-950 text-amber-300 border border-amber-800 px-2 py-0.5 rounded-full font-mono">
                          {selectedLog.action} / {selectedLog.user}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-muted-foreground text-2xs block">تامین‌کننده / سورس:</span>
                          <span className="font-bold text-white">{supplier || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-2xs block">ماده اولیه (Material):</span>
                          <span className="font-bold text-white">{material || 'N/A'}</span>
                        </div>
                      </div>

                      {/* RPN, SRI & Risk Level Comparison */}
                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-background/20 text-xs text-center">
                        <div className="bg-background/10 p-2 rounded-lg border border-background/20">
                          <span className="text-muted-foreground text-2xs block">RPN (شاخص ریسک)</span>
                          <span className="font-mono text-rose-300 text-2xs block">{prevRPN ?? '-'}</span>
                          <span className="font-mono text-emerald-400 font-bold text-xs">{newRPN ?? '-'}</span>
                        </div>
                        <div className="bg-background/10 p-2 rounded-lg border border-background/20">
                          <span className="text-muted-foreground text-2xs block">SRI (ریسک کل)</span>
                          <span className="font-mono text-rose-300 text-2xs block">{prevSRI ?? '-'}</span>
                          <span className="font-mono text-emerald-400 font-bold text-xs">{newSRI ?? '-'}</span>
                        </div>
                        <div className="bg-background/10 p-2 rounded-lg border border-background/20">
                          <span className="text-muted-foreground text-2xs block">سطح ریسک</span>
                          <span className="font-bold text-rose-300 text-2xs block">{prevLevel ?? '-'}</span>
                          <span className="font-bold text-emerald-400 text-xs">{newLevel ?? '-'}</span>
                        </div>
                      </div>

                      {/* FMEA Parameter Changes */}
                      {(prevSev !== undefined || newSev !== undefined) && (
                        <div className="pt-2 border-t border-background/20 text-2xs space-y-1">
                          <span className="text-muted-foreground text-2xs block">پارامترهای FMEA (شدت، وقوع، تشخیص):</span>
                          <div className="grid grid-cols-3 gap-2 text-center font-mono text-2xs bg-background/10 p-2 rounded-lg border border-background/20">
                            <div>
                              <span className="text-muted-foreground block">شدت (Severity)</span>
                              <span className="text-background/80">{prevSev ?? '-'} &rarr; <strong className="text-amber-300">{newSev ?? '-'}</strong></span>
                            </div>
                            <div>
                              <span className="text-muted-foreground block">وقوع (Occurrence)</span>
                              <span className="text-background/80">{prevOcc ?? '-'} &rarr; <strong className="text-amber-300">{newOcc ?? '-'}</strong></span>
                            </div>
                            <div>
                              <span className="text-muted-foreground block">تشخیص (Detectability)</span>
                              <span className="text-background/80">{prevDet ?? '-'} &rarr; <strong className="text-amber-300">{newDet ?? '-'}</strong></span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* STRUCTURED SPS & SCORES SUMMARY CARD */}
                {(() => {
                  const bef = selectedLog.before && typeof selectedLog.before === 'object' ? selectedLog.before : {};
                  const aft = selectedLog.after && typeof selectedLog.after === 'object' ? selectedLog.after : {};

                  const isScore = 
                    selectedLog.entityType === 'Score' || 
                    (selectedLog.description && (selectedLog.description.includes('SPS') || selectedLog.description.includes('امتیاز')));

                  if (!isScore) return null;

                  const prevTotal = bef.totalSPS ?? (bef.scores ? Math.round((bef.scores.commercial*0.2 + bef.scores.qa*0.4 + bef.scores.planning*0.1 + bef.scores.finance*0.3)*10)/10 : '-');
                  const newTotal = aft.totalSPS ?? (aft.scores ? Math.round((aft.scores.commercial*0.2 + aft.scores.qa*0.4 + aft.scores.planning*0.1 + aft.scores.finance*0.3)*10)/10 : '-');
                  const prevGrade = bef.grade ?? '-';
                  const newGrade = aft.grade ?? '-';

                  const prevQA = bef.qualityScore ?? bef.scores?.qa ?? '-';
                  const newQA = aft.qualityScore ?? aft.scores?.qa ?? '-';
                  const prevFin = bef.financeScore ?? bef.scores?.finance ?? '-';
                  const newFin = aft.financeScore ?? aft.scores?.finance ?? '-';
                  const prevCom = bef.commercialScore ?? bef.scores?.commercial ?? '-';
                  const newCom = aft.commercialScore ?? aft.scores?.commercial ?? '-';
                  const prevPln = bef.planningScore ?? bef.scores?.planning ?? '-';
                  const newPln = aft.planningScore ?? aft.scores?.planning ?? '-';

                  return (
                    <div className="bg-foreground text-background p-4 rounded-xl space-y-3 border border-border shadow-xs">
                      <div className="flex items-center justify-between pb-2 border-b border-background/20">
                        <div className="flex items-center gap-2">
                          <Calculator className="w-4 h-4 text-emerald-400" />
                          <span className="text-xs font-bold">جزئیات محاسبه امتیاز SPS و رتبه‌بندی</span>
                        </div>
                        <span className="text-2xs bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded-full font-mono">
                          SPS Score Calculation
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-background/10 p-2.5 rounded-lg border border-background/20">
                          <span className="text-muted-foreground text-2xs block">امتیاز کل SPS قبلی:</span>
                          <span className="font-mono text-rose-300 font-bold text-sm">{prevTotal} (Grade: {prevGrade})</span>
                        </div>
                        <div className="bg-background/10 p-2.5 rounded-lg border border-background/20">
                          <span className="text-muted-foreground text-2xs block">امتیاز کل SPS جدید:</span>
                          <span className="font-mono text-emerald-400 font-bold text-sm">{newTotal} (Grade: {newGrade})</span>
                        </div>
                      </div>

                      {/* Department Breakdown */}
                      <div className="pt-2 border-t border-background/20 space-y-1 text-2xs">
                        <span className="text-muted-foreground text-2xs block">تفکیک امتیازات بخش‌های ارزیابی (Department Breakdown):</span>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-2xs font-mono bg-background/10 p-2 rounded-lg border border-background/20">
                          <div>
                            <span className="text-muted-foreground block">کیفیت QA (40%)</span>
                            <span className="text-background/80">{prevQA} &rarr; <strong className="text-emerald-400">{newQA}</strong></span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">مالی (30%)</span>
                            <span className="text-background/80">{prevFin} &rarr; <strong className="text-emerald-400">{newFin}</strong></span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">بازرگانی (20%)</span>
                            <span className="text-background/80">{prevCom} &rarr; <strong className="text-emerald-400">{newCom}</strong></span>
                          </div>
                          <div>
                            <span className="text-muted-foreground block">انبار/برنامه‌ریزی (10%)</span>
                            <span className="text-background/80">{prevPln} &rarr; <strong className="text-emerald-400">{newPln}</strong></span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* STRUCTURED RANKING SUMMARY CARD */}
                {(() => {
                  const bef = selectedLog.before && typeof selectedLog.before === 'object' ? selectedLog.before : {};
                  const aft = selectedLog.after && typeof selectedLog.after === 'object' ? selectedLog.after : {};

                  const isRanking = 
                    selectedLog.entityType === 'Ranking' || 
                    (selectedLog.description && (selectedLog.description.includes('رتبه') || selectedLog.description.includes('Rank')));

                  if (!isRanking) return null;

                  const prevRank = bef.previousRank ?? '-';
                  const newRank = aft.newRank ?? '-';
                  const prevSPS = bef.previousSPS ?? '-';
                  const newSPS = aft.newSPS ?? '-';

                  return (
                    <div className="bg-foreground text-background p-4 rounded-xl space-y-3 border border-border shadow-xs">
                      <div className="flex items-center justify-between pb-2 border-b border-background/20">
                        <div className="flex items-center gap-2">
                          <Award className="w-4 h-4 text-purple-400" />
                          <span className="text-xs font-bold">تغییر خودکار جایگاه در جدول رتبه‌بندی (Supplier Ranking)</span>
                        </div>
                        <span className="text-2xs bg-purple-950 text-purple-300 border border-purple-800 px-2 py-0.5 rounded-full font-mono">
                          SYSTEM / Auto-Recalculated
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-center">
                        <div className="bg-background/10 p-3 rounded-lg border border-background/20">
                          <span className="text-muted-foreground text-2xs block">رتبه قبلی (Previous Rank):</span>
                          <span className="font-mono text-rose-400 font-extrabold text-lg">#{prevRank}</span>
                          <span className="text-muted-foreground text-2xs block font-mono">SPS: {prevSPS}</span>
                        </div>
                        <div className="bg-background/10 p-3 rounded-lg border border-background/20">
                          <span className="text-muted-foreground text-2xs block">رتبه جدید (New Rank):</span>
                          <span className="font-mono text-emerald-400 font-extrabold text-lg">#{newRank}</span>
                          <span className="text-muted-foreground text-2xs block font-mono">SPS: {newSPS}</span>
                        </div>
                      </div>

                      <div className="text-2xs text-background/70 bg-background/10 p-2 rounded-lg flex items-center justify-between border border-background/20">
                        <span>دلیل محاسبه: {selectedLog.reason || 'SPS score recalculated'}</span>
                        <span className="text-purple-300 font-mono">Trigger Source: SYSTEM</span>
                      </div>
                    </div>
                  );
                })()}
                </div>
              </details>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-border bg-muted text-center shrink-0">
              <p className="text-2xs text-muted-foreground font-medium">انطباق تضمین کیفیت دارویی با دستورالعمل‌های ICH Q9 و ضوابط سازمان غذا و دارو (ALCOA+)</p>
            </div>
          </>
        )}
      </FormModal>
    </div>
  );
};
