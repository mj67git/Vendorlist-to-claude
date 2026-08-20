import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { 
  Search, Filter, SlidersHorizontal, ArrowUpDown, X, Eye, 
  Clock, ShieldAlert, CheckCircle, AlertTriangle, FileText, 
  Activity, User as UserIcon, HelpCircle, Layers, ClipboardList,
  RotateCcw, Calendar, Key, AlertCircle, Loader2, FlaskConical,
  Calculator, Award, TrendingUp, Cpu
} from 'lucide-react';
import { Pagination } from './Pagination';

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
  Create: { label: 'ایجاد', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', text: 'text-emerald-700' },
  Update: { label: 'ویرایش', bg: 'bg-blue-50 text-blue-700 border-blue-200', text: 'text-blue-700' },
  Delete: { label: 'حذف', bg: 'bg-rose-50 text-rose-700 border-rose-200', text: 'text-rose-700' },
  Reject: { label: 'مردودسازی', bg: 'bg-red-50 text-red-700 border-red-200', text: 'text-red-700' },
  'System Update': { label: 'تغییر خودکار سیستم', bg: 'bg-purple-50 text-purple-700 border-purple-200', text: 'text-purple-700' },
  Restore: { label: 'بازگردانی', bg: 'bg-indigo-50 text-indigo-700 border-indigo-200', text: 'text-indigo-700' },
  Login: { label: 'ورود به سیستم', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', text: 'text-emerald-700' },
  LOGIN: { label: 'ورود موفق', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', text: 'text-emerald-700' },
  LOGOUT: { label: 'خروج از سیستم', bg: 'bg-slate-50 text-slate-700 border-slate-200', text: 'text-slate-700' },
  FAILED_LOGIN: { label: 'ورود ناموفق (امنیتی)', bg: 'bg-rose-50 text-rose-700 border-rose-200', text: 'text-rose-700' },
  CREATE_USER: { label: 'ایجاد کاربر', bg: 'bg-teal-50 text-teal-700 border-teal-200', text: 'text-teal-700' },
  UPDATE_USER: { label: 'ویرایش کاربر', bg: 'bg-blue-50 text-blue-700 border-blue-200', text: 'text-blue-700' },
  DELETE_USER: { label: 'حذف کاربر', bg: 'bg-rose-50 text-rose-700 border-rose-200', text: 'text-rose-700' },
  ROLE_CHANGE: { label: 'تغییر سمت (Role)', bg: 'bg-purple-50 text-purple-700 border-purple-200', text: 'text-purple-700' },
  PERMISSION_CHANGE: { label: 'تغییر دسترسی', bg: 'bg-amber-50 text-amber-700 border-amber-200', text: 'text-amber-700' }
};

const severityLabels: Record<string, { label: string; bg: string; text: string; icon: any }> = {
  Info: { label: 'عادی (Info)', bg: 'bg-slate-50 text-slate-700 border-slate-200', text: 'text-slate-700', icon: InfoIcon },
  Warning: { label: 'هشدار (Warning)', bg: 'bg-amber-50 text-amber-700 border-amber-200', text: 'text-amber-700', icon: AlertTriangle },
  Critical: { label: 'بحرانی (Critical)', bg: 'bg-rose-50 text-rose-700 border-rose-200', text: 'text-rose-700', icon: ShieldAlert }
};

function InfoIcon(props: any) {
  return <CheckCircle className="w-3.5 h-3.5" {...props} />;
}

const MOCK_AUDIT_LOGS: AuditLog[] = [
  {
    id: "AUD-1405-001",
    date: "1405/05/15",
    time: "14:32:18",
    user: "علی علوی (مدیر QA)",
    role: "qa",
    module: "مدیریت سورس‌ها",
    action: "Update",
    recordName: "سورس نمونه آسپیرین پارس دارو",
    severity: "Warning",
    description: "تغییر وضعیت نمونه به تایید مشروط بر اساس نتایج دوره‌ای آزمایشگاهی شماره QC-9833",
    before: { status: "approved", grade: "A", validationNotes: "نتایج کامل پاس شده است" },
    after: { status: "conditional", grade: "B", validationNotes: "تایید مشروط به دلیل نوسان جزئی خلوص بچ شماره 9021" },
    reason: "نتایج آنالیز دوره ای خلوص پایداری مواد اولیه کمکی نوسان داشت.",
    correlationId: "COR-QA-2026-99321"
  },
  {
    id: "AUD-1405-002",
    date: "1405/05/15",
    time: "13:10:45",
    user: "مهندس محمدی (واحد آزمایشگاه)",
    role: "lab",
    module: "آزمایشگاه کنترل کیفیت",
    action: "Reject",
    recordName: "بچ شماره 9042 - پاراستامول هندی",
    severity: "Critical",
    description: "ثبت انحراف کیفی OOS و رد صلاحیت بچ دریافتی به علت عدم مطابقت با فارماکوپه",
    before: { testStatus: "Under Testing", purity: "99.1%", conformity: "Pending" },
    after: { testStatus: "Rejected", purity: "94.2%", conformity: "OOS - Non Compliant" },
    reason: "کاهش درصد پلوتونیوم ناخالصی فراتر از حد مجاز ICH Q3A",
    correlationId: "COR-LAB-2026-11029"
  },
  {
    id: "AUD-1405-003",
    date: "1405/05/15",
    time: "11:05:12",
    user: "علیرضا رضایی (ادمین)",
    role: "admin",
    module: "مدیریت کاربران",
    action: "Create",
    recordName: "کاربر جدید: سارا احمدی (Finance)",
    severity: "Info",
    description: "تعریف کاربر جدید در سیستم با دسترسی واحد مالی و مالیاتی خرید سورس‌ها",
    before: null,
    after: { username: "s.ahmadi", role: "finance", permissions: ["Read", "UpdateScores"] },
    reason: "جایگزینی موقت پرسنل واحد مالی و ایجاد دسترسی نظارت بر خرید خارجی سورس کالا",
    correlationId: "COR-ADM-2026-00411"
  },
  {
    id: "AUD-1405-004",
    date: "1405/05/14",
    time: "17:40:00",
    user: "مهندس علوی (واحد بازرگانی)",
    role: "commercial",
    module: "ارزیابی تامین‌کنندگان",
    action: "Update",
    recordName: "تامین‌کننده پیشرو طب آریا",
    severity: "Info",
    description: "بروزرسانی امتیازات تجاری و اسناد نمایندگی رسمی بر اساس ممیزی مستندات مالی",
    before: { complianceScore: 78, isLicensed: false },
    after: { complianceScore: 92, isLicensed: true },
    reason: "دریافت نسخه تایید شده پروفرما و تاییدیه رسمی واردات سازمان غذا و دارو",
    correlationId: "COR-COM-2026-22104"
  },
  {
    id: "AUD-1405-005",
    date: "1405/05/12",
    time: "09:15:33",
    user: "سهراب سپهری (انبار دارویی)",
    role: "planning",
    module: "برنامه‌ریزی و انبار",
    action: "Create",
    recordName: "رسید انبار شماره REC-1044",
    severity: "Info",
    description: "ثبت تست کیفیت و آنالیز فیزیکوشیمیایی نشاسته دارویی دریافتی",
    before: null,
    after: { batchNo: "C-991", status: "Pass", purity: "99.8%", microbiologicalTest: "Compliant" },
    reason: "آزمایش روتین آزادسازی مواد خام ورودی سالن تولید",
    correlationId: "COR-LAB-2026-10221"
  }
];

export const AuditTrailView: React.FC = () => {
  // Navigation & view states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  
  // Filter States
  const [filterUser, setFilterUser] = useState('all');
  const [filterModule, setFilterModule] = useState('all');
  const [filterEventType, setFilterEventType] = useState('all');
  const [filterAction, setFilterAction] = useState('all');
  const [filterSeverity, setFilterSeverity] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Sorting States
  const [sortField, setSortField] = useState<'date' | 'time' | 'user' | 'severity'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Pagination States
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

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

  // Dynamic filter lists for select options
  const uniqueUsers = useMemo(() => {
    const mockUsers = Array.from(new Set(MOCK_AUDIT_LOGS.map(log => log.user)));
    return Array.from(new Set([...mockUsers, ...apiUsers]));
  }, [apiUsers]);

  const STANDARD_MODULES = [
    'ارزیابی تامین‌کنندگان',
    'مدیریت سورس‌ها',
    'شناسنامه کالا / مواد',
    'آزمایشگاه کنترل کیفیت',
    'ارزیابی ریسک',
    'امنیتی و احراز هویت',
    'مدیریت کاربران'
  ];

  const uniqueModules = useMemo(() => {
    const mockModules = Array.from(new Set(MOCK_AUDIT_LOGS.map(log => log.module)));
    return Array.from(new Set([...STANDARD_MODULES, ...mockModules, ...apiModules]));
  }, [apiModules]);

  // Fetch real logs from backend
  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = localStorage.getItem('app_jwt_token');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const activeSeverity = quickSeverityFilter || filterSeverity;

      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: itemsPerPage.toString(),
        userId: filterUser !== 'all' ? filterUser : '',
        module: filterModule !== 'all' ? filterModule : '',
        eventType: filterEventType !== 'all' ? filterEventType : '',
        action: filterAction !== 'all' ? filterAction : '',
        severity: activeSeverity !== 'all' ? activeSeverity : '',
        quickFilter: quickCategoryFilter !== 'all' ? quickCategoryFilter : '',
        startDate,
        endDate,
        query: searchQuery,
      });

      const response = await fetch(`/api/audit-logs?${params.toString()}`, { headers });
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
            ipAddress: l.ipAddress || l.afterData?.ipAddress || l.afterData?.ip || '127.0.0.1',
            userAgent: l.userAgent || l.afterData?.userAgent || l.afterData?.device || 'Unknown Browser/Device',
          };
        });

        // Use mock data as fallback if no real database/JSON logs are present
        if (formattedData.length === 0 && !searchQuery && filterUser === 'all' && filterModule === 'all' && filterAction === 'all' && activeSeverity === 'all' && !startDate && !endDate) {
          // Client-side paging on mock data
          let filteredMock = [...MOCK_AUDIT_LOGS];
          setLogs(filteredMock.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage));
          setTotalItems(MOCK_AUDIT_LOGS.length);
        } else {
          setLogs(formattedData);
          setTotalItems(result.total || 0);
        }
      }
    } catch (err) {
      console.error('Failed to fetch real audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, filterUser, filterModule, filterEventType, filterAction, filterSeverity, quickSeverityFilter, quickCategoryFilter, startDate, endDate, searchQuery, itemsPerPage]);

  // Fetch metrics and filters
  const fetchStatsAndFilters = useCallback(async () => {
    try {
      const token = localStorage.getItem('app_jwt_token');
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      const [statsRes, filtersRes] = await Promise.all([
        fetch('/api/audit-logs/stats', { headers }),
        fetch('/api/audit-logs/filters', { headers })
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
          // Mock stats fallback
          const mockTotal = MOCK_AUDIT_LOGS.length;
          const mockCritical = MOCK_AUDIT_LOGS.filter(l => l.severity === 'Critical').length;
          const mockWarning = MOCK_AUDIT_LOGS.filter(l => l.severity === 'Warning').length;
          setStats({
            total: mockTotal,
            critical: mockCritical,
            warning: mockWarning,
            activeUsers: 5,
            lastUpdated: "14:32:18"
          });
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
      const token = localStorage.getItem('app_jwt_token');
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const response = await fetch(`/api/audit-logs/${log.id}`, { headers });
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
  const handleSort = (field: 'date' | 'time' | 'user' | 'severity') => {
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
    setFilterAction('all');
    setFilterSeverity('all');
    setStartDate('');
    setEndDate('');
    setQuickSeverityFilter(null);
    setQuickCategoryFilter('all');
    setCurrentPage(1);
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
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-slate-900/5 border border-slate-900/10 rounded-xl text-slate-800">
              <ClipboardList className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-extrabold text-[#1D1D1F] tracking-tight">Audit Trail</h1>
          </div>
          <p className="text-slate-500 text-xs">سامانه مانیتورینگ فعالیت‌های سیستم و تاریخچه تغییرات فرآیندی (GMP Compliance)</p>
        </div>

        {/* TOP METRIC CHIPS */}
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <div className="bg-white border border-slate-100 px-3 py-1.5 rounded-xl shadow-xs flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            <span className="text-[11px] text-slate-400 font-medium">کل لاگ‌ها:</span>
            <span className="text-xs font-bold font-mono text-slate-700">{stats.total}</span>
          </div>
          <div className="bg-rose-50 border border-rose-100 px-3 py-1.5 rounded-xl flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-600" />
            <span className="text-[11px] text-rose-500 font-medium">خطای بحرانی:</span>
            <span className="text-xs font-bold font-mono text-rose-700">{stats.critical}</span>
          </div>
          <div className="bg-amber-50 border border-amber-100 px-3 py-1.5 rounded-xl flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-[11px] text-amber-600 font-medium">هشدارها:</span>
            <span className="text-xs font-bold font-mono text-amber-700">{stats.warning}</span>
          </div>
          <div className="bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-xl flex items-center gap-2">
            <span className="text-[11px] text-slate-400 font-medium">آخرین بروزرسانی:</span>
            <span className="text-xs font-bold font-mono text-slate-600">{stats.lastUpdated}</span>
          </div>
        </div>
      </div>

      {/* SEARCH AND QUICK FILTER CONTROLS */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row gap-3">
          {/* Main search bar */}
          <div className="relative flex-1">
            <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400">
              <Search className="w-4 h-4" />
            </span>
            <input
              type="text"
              placeholder="جستجو بر اساس نام کاربر، واحد، رکورد، فعالیت یا توضیحات..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }}
              className="w-full bg-slate-50 border border-slate-200/80 rounded-xl pr-10 pl-4 py-2.5 text-xs text-[#1D1D1F] placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#0071E3] focus:bg-white transition-all duration-200 font-medium"
            />
          </div>

          {/* Quick Filter buttons */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 shrink-0">
            <button
              onClick={() => { setQuickSeverityFilter(null); setCurrentPage(1); }}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border shrink-0 cursor-pointer ${
                quickSeverityFilter === null 
                  ? 'bg-slate-900 border-slate-950 text-white shadow-xs' 
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              همه رکوردهای لاگ
            </button>
            <button
              onClick={() => { setQuickSeverityFilter('Critical'); setCurrentPage(1); }}
              className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border flex items-center gap-1.5 shrink-0 cursor-pointer ${
                quickSeverityFilter === 'Critical'
                  ? 'bg-rose-600 border-rose-700 text-white shadow-xs'
                  : 'bg-rose-50/50 border-rose-200/60 text-rose-700 hover:bg-rose-50'
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
                  : 'bg-amber-50/50 border-amber-200/60 text-amber-700 hover:bg-amber-50'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              هشدارها (Warning)
            </button>
            <button
              onClick={handleResetFilters}
              title="پاک کردن تمامی فیلترها"
              className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-700 rounded-xl transition-all cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* QUICK CATEGORY FILTERS (PHASE 5, PHASE 6 & PHASE 7 SECURITY) */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold text-slate-500 ml-1">دسته‌بندی‌های ویژه Audit:</span>
          <button
            onClick={() => { setQuickCategoryFilter('all'); setCurrentPage(1); }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
              quickCategoryFilter === 'all'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            همه رویدادها
          </button>
          <button
            onClick={() => { setQuickCategoryFilter('user_activity'); setCurrentPage(1); }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
              quickCategoryFilter === 'user_activity'
                ? 'bg-cyan-600 text-white shadow-xs'
                : 'bg-cyan-50 text-cyan-800 hover:bg-cyan-100 border border-cyan-200/60'
            }`}
          >
            <Activity className="w-3 h-3" />
            User Activity (فعالیت کاربران)
          </button>
          <button
            onClick={() => { setQuickCategoryFilter('authentication'); setCurrentPage(1); }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
              quickCategoryFilter === 'authentication'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200/60'
            }`}
          >
            <Key className="w-3 h-3" />
            Authentication (ورود و خروج)
          </button>
          <button
            onClick={() => { setQuickCategoryFilter('authorization'); setCurrentPage(1); }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
              quickCategoryFilter === 'authorization'
                ? 'bg-purple-600 text-white shadow-xs'
                : 'bg-purple-50 text-purple-800 hover:bg-purple-100 border border-purple-200/60'
            }`}
          >
            <UserIcon className="w-3 h-3" />
            Authorization (نقش و دسترسی)
          </button>
          <button
            onClick={() => { setQuickCategoryFilter('security_events'); setCurrentPage(1); }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
              quickCategoryFilter === 'security_events'
                ? 'bg-rose-600 text-white shadow-xs'
                : 'bg-rose-50 text-rose-800 hover:bg-rose-100 border border-rose-200/60'
            }`}
          >
            <ShieldAlert className="w-3 h-3" />
            Security Events (امنیتی)
          </button>
          <button
            onClick={() => { setQuickCategoryFilter('risk_events'); setCurrentPage(1); }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
              quickCategoryFilter === 'risk_events'
                ? 'bg-amber-600 text-white shadow-xs'
                : 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-200/60'
            }`}
          >
            <AlertTriangle className="w-3 h-3" />
            Risk Events (ریسک)
          </button>
          <button
            onClick={() => { setQuickCategoryFilter('fmea_changes'); setCurrentPage(1); }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
              quickCategoryFilter === 'fmea_changes'
                ? 'bg-orange-600 text-white shadow-xs'
                : 'bg-orange-50 text-orange-800 hover:bg-orange-100 border border-orange-200/60'
            }`}
          >
            <ClipboardList className="w-3 h-3" />
            FMEA Changes
          </button>
          <button
            onClick={() => { setQuickCategoryFilter('score_changes'); setCurrentPage(1); }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
              quickCategoryFilter === 'score_changes'
                ? 'bg-teal-600 text-white shadow-xs'
                : 'bg-teal-50 text-teal-800 hover:bg-teal-100 border border-teal-200/60'
            }`}
          >
            <Calculator className="w-3 h-3" />
            Score Changes
          </button>
          <button
            onClick={() => { setQuickCategoryFilter('lab_events'); setCurrentPage(1); }}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 ${
              quickCategoryFilter === 'lab_events'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200/60'
            }`}
          >
            <FlaskConical className="w-3 h-3" />
            Laboratory Events
          </button>
        </div>

        {/* DETAILED FILTERS ACCORDION / BOX */}
        <div className="pt-4 border-t border-slate-100 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {/* User Filter */}
          <div className="space-y-1">
            <label className="text-slate-500 text-[10px] font-bold">فیلتر کاربر</label>
            <select
              value={filterUser}
              onChange={e => { setFilterUser(e.target.value); setCurrentPage(1); }}
              className="w-full bg-slate-50/80 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
            >
              <option value="all">همه کاربران</option>
              {uniqueUsers.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>

          {/* Module Filter */}
          <div className="space-y-1">
            <label className="text-slate-500 text-[10px] font-bold">فیلتر ماژول</label>
            <select
              value={filterModule}
              onChange={e => { setFilterModule(e.target.value); setCurrentPage(1); }}
              className="w-full bg-slate-50/80 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
            >
              <option value="all">همه ماژول‌ها</option>
              {uniqueModules.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Event Type Filter (PHASE 7 SECURITY) */}
          <div className="space-y-1">
            <label className="text-slate-500 text-[10px] font-bold">گروه رویداد (Event Category)</label>
            <select
              value={filterEventType}
              onChange={e => { setFilterEventType(e.target.value); setCurrentPage(1); }}
              className="w-full bg-slate-50/80 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
            >
              <option value="all">همه گروه‌ها</option>
              <option value="User Activity">فعالیت کاربران (User Activity)</option>
              <option value="Authentication">احراز هویت (Authentication)</option>
              <option value="Authorization">سطوح دسترسی (Authorization)</option>
              <option value="Security">امنیتی و حفاظتی (Security)</option>
            </select>
          </div>

          {/* Action Filter */}
          <div className="space-y-1">
            <label className="text-slate-500 text-[10px] font-bold">فیلتر نوع عملیات</label>
            <select
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); setCurrentPage(1); }}
              className="w-full bg-slate-50/80 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
            >
              <option value="all">همه عملیات</option>
              <option value="LOGIN">ورود موفق (LOGIN)</option>
              <option value="LOGOUT">خروج (LOGOUT)</option>
              <option value="FAILED_LOGIN">ورود ناموفق (FAILED_LOGIN)</option>
              <option value="CREATE_USER">ایجاد کاربر (CREATE_USER)</option>
              <option value="UPDATE_USER">ویرایش کاربر (UPDATE_USER)</option>
              <option value="DELETE_USER">حذف کاربر (DELETE_USER)</option>
              <option value="ROLE_CHANGE">تغییر سمت (ROLE_CHANGE)</option>
              <option value="PERMISSION_CHANGE">تغییر دسترسی (PERMISSION_CHANGE)</option>
              <option value="Create">ایجاد رکورد (Create)</option>
              <option value="Update">ویرایش رکورد (Update)</option>
              <option value="Delete">حذف رکورد (Delete)</option>
              <option value="System Update">بروزرسانی سیستم (System Update)</option>
              <option value="Reject">مردودی (Reject)</option>
            </select>
          </div>

          {/* Severity Filter */}
          <div className="space-y-1">
            <label className="text-slate-500 text-[10px] font-bold">سطح بحرانیت (Severity)</label>
            <select
              value={filterSeverity}
              onChange={e => { setFilterSeverity(e.target.value); setQuickSeverityFilter(null); setCurrentPage(1); }}
              className="w-full bg-slate-50/80 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-[#0071E3]"
            >
              <option value="all">همه سطوح</option>
              <option value="Info">عادی (Information)</option>
              <option value="Warning">هشدار (Warning)</option>
              <option value="Critical">بحرانی (Critical)</option>
            </select>
          </div>

          {/* Start Date */}
          <div className="space-y-1">
            <label className="text-slate-500 text-[10px] font-bold">از تاریخ (روز)</label>
            <input
              type="text"
              placeholder="مثال: 1405/05/12"
              value={startDate}
              onChange={e => { setStartDate(e.target.value); setCurrentPage(1); }}
              className="w-full bg-slate-50/80 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-mono focus:outline-none focus:ring-1 focus:ring-[#0071E3] text-left"
            />
          </div>

          {/* End Date */}
          <div className="space-y-1">
            <label className="text-slate-500 text-[10px] font-bold">تا تاریخ (روز)</label>
            <input
              type="text"
              placeholder="مثال: 1405/05/15"
              value={endDate}
              onChange={e => { setEndDate(e.target.value); setCurrentPage(1); }}
              className="w-full bg-slate-50/80 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-mono focus:outline-none focus:ring-1 focus:ring-[#0071E3] text-left"
            />
          </div>
        </div>
      </div>

      {/* TABLE DATA LIST CONTAINER */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs relative">
        {isLoading && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-xs z-10 flex items-center justify-center">
            <div className="flex items-center gap-2 bg-white px-4 py-2.5 rounded-xl border border-slate-100 shadow-sm text-slate-600 font-semibold text-xs">
              <Loader2 className="w-4 h-4 animate-spin text-[#0071E3]" />
              <span>در حال بازیابی رکوردهای لاگ واقعی...</span>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs font-bold border-b border-slate-100">
                <th className="py-3 px-4 w-[12%]">
                  <button 
                    onClick={() => handleSort('date')} 
                    className="flex items-center gap-1.5 hover:text-slate-800 transition-colors font-bold cursor-pointer"
                  >
                    تاریخ {sortField === 'date' && (sortDirection === 'asc' ? <ArrowUpDown className="w-3 h-3 rotate-180" /> : <ArrowUpDown className="w-3 h-3" />)}
                  </button>
                </th>
                <th className="py-3 px-4 w-[10%]">
                  <button 
                    onClick={() => handleSort('time')} 
                    className="flex items-center gap-1.5 hover:text-slate-800 transition-colors font-bold cursor-pointer"
                  >
                    ساعت {sortField === 'time' && (sortDirection === 'asc' ? <ArrowUpDown className="w-3 h-3 rotate-180" /> : <ArrowUpDown className="w-3 h-3" />)}
                  </button>
                </th>
                <th className="py-3 px-4 w-[15%]">
                  <button 
                    onClick={() => handleSort('user')} 
                    className="flex items-center gap-1.5 hover:text-slate-800 transition-colors font-bold cursor-pointer"
                  >
                    کاربر {sortField === 'user' && (sortDirection === 'asc' ? <ArrowUpDown className="w-3 h-3 rotate-180" /> : <ArrowUpDown className="w-3 h-3" />)}
                  </button>
                </th>
                <th className="py-3 px-4 w-[12%]">سمت</th>
                <th className="py-3 px-4 w-[13%]">ماژول</th>
                <th className="py-3 px-4 w-[10%]">عملیات</th>
                <th className="py-3 px-4 w-[15%]">رکورد هدف</th>
                <th className="py-3 px-4 w-[13%]">
                  <button 
                    onClick={() => handleSort('severity')} 
                    className="flex items-center gap-1.5 hover:text-slate-800 transition-colors font-bold cursor-pointer"
                  >
                    سطح ریسک {sortField === 'severity' && (sortDirection === 'asc' ? <ArrowUpDown className="w-3 h-3 rotate-180" /> : <ArrowUpDown className="w-3 h-3" />)}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
              {logs.length > 0 ? (
                logs.map((log) => {
                  const actMeta = actionLabels[log.action] || { label: log.action, bg: 'bg-slate-50', text: 'text-slate-700' };
                  const sevMeta = severityLabels[log.severity] || { label: log.severity, bg: 'bg-slate-50', text: 'text-slate-700', icon: InfoIcon };
                  const SevIcon = sevMeta.icon;

                  return (
                    <tr 
                      key={log.id}
                      onClick={() => handleOpenDrawer(log)}
                      className="hover:bg-slate-50/60 transition-all duration-150 cursor-pointer group"
                    >
                      <td className="py-3.5 px-4 text-slate-500 font-mono text-[11px] font-bold">{log.date}</td>
                      <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">{log.time}</td>
                      <td className="py-3.5 px-4 font-bold text-slate-800">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                            <UserIcon className="w-3 h-3" />
                          </div>
                          <span className="truncate max-w-[120px]">{log.user}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                        {roleLabels[log.role] || log.role}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 font-semibold">{log.module}</td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border inline-block ${actMeta.bg}`}>
                          {actMeta.label}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-800 font-bold max-w-[150px] truncate" title={log.recordName}>
                        {log.recordName}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 shrink-0 ${sevMeta.bg}`}>
                          <SevIcon className="w-3 h-3 shrink-0" />
                          {sevMeta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 font-medium">
                    <div className="flex flex-col items-center gap-2">
                      <AlertCircle className="w-8 h-8 text-slate-300" />
                      <span>هیچ رکورد لاگی با مشخصات انتخابی یافت نشد.</span>
                      <button 
                        onClick={handleResetFilters}
                        className="text-[#0071E3] font-bold text-xs hover:underline mt-1 cursor-pointer"
                      >
                        پاک کردن فیلترها
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* PAGINATION PANEL */}
        {totalPages > 1 && (
          <div className="px-5 pb-5">
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

      {/* DETAIL MODAL */}
      <div 
        className={`fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 transition-all duration-300 ${
          selectedLog ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
        style={{ direction: 'rtl' }}
      >
        {/* BACKDROP */}
        <div 
          onClick={() => setSelectedLog(null)}
          className={`absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 ${
            selectedLog ? 'opacity-100' : 'opacity-0'
          }`}
        />
        
        {/* MODAL CONTENT */}
        <div 
          className={`relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden transition-all duration-300 ${
            selectedLog ? 'scale-100 translate-y-0 opacity-100' : 'scale-95 translate-y-4 opacity-0'
          }`}
        >
          {selectedLog && (
            <>
              {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="space-y-1">
                <span className="text-[10px] font-bold font-mono text-slate-400 bg-slate-200/50 px-2 py-0.5 rounded-md">
                  {selectedLog.id}
                </span>
                <h3 className="text-sm font-black text-slate-800 mt-1">جزئیات ثبت ردیابی تغییرات (Audit)</h3>
              </div>
              <button 
                onClick={() => setSelectedLog(null)}
                className="p-1.5 rounded-lg bg-white border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Core Information Cards */}
              <div className="grid grid-cols-2 gap-3.5 bg-slate-50 p-4 rounded-xl border border-slate-100">
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-400 font-bold block">کاربر ثبت‌کننده:</span>
                  <span className="text-xs font-bold text-slate-800">{selectedLog.user}</span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] text-slate-400 font-bold block">سمت سازمانی:</span>
                  <span className="text-xs font-bold text-slate-600">{roleLabels[selectedLog.role] || selectedLog.role}</span>
                </div>
                <div className="space-y-0.5 pt-2 border-t border-slate-200/50">
                  <span className="text-[10px] text-slate-400 font-bold block">تاریخ و ساعت:</span>
                  <span className="text-xs font-bold text-slate-700 font-mono">{selectedLog.date} - {selectedLog.time}</span>
                </div>
                <div className="space-y-0.5 pt-2 border-t border-slate-200/50">
                  <span className="text-[10px] text-slate-400 font-bold block">شناسه همبستگی (Correlation):</span>
                  <span className="text-xs font-mono font-bold text-slate-500">{selectedLog.correlationId}</span>
                </div>
              </div>

              {/* Scope cards */}
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold">گروه رویداد (Event Category):</span>
                  <span className="font-bold text-slate-800 bg-cyan-50 text-cyan-800 border border-cyan-200 px-2 py-0.5 rounded-md">
                    {selectedLog.eventType || 'User Activity'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold">ماژول مربوطه:</span>
                  <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md">{selectedLog.module}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold">عنوان هدف:</span>
                  <span className="font-bold text-slate-800">{selectedLog.recordName}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold">نوع اکشن:</span>
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${actionLabels[selectedLog.action]?.bg || 'bg-slate-100 text-slate-700'}`}>
                    {actionLabels[selectedLog.action]?.label || selectedLog.action}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold">آدرس IP کاربر:</span>
                  <span className="font-mono font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md dir-ltr">{selectedLog.ipAddress || '127.0.0.1'}</span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold">دستگاه / مرورگر:</span>
                  <span className="font-mono text-[10px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-md truncate max-w-[200px]" title={selectedLog.userAgent}>
                    {selectedLog.userAgent || 'Chrome / Windows'}
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-400 font-bold">سطح بحرانیت:</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border inline-flex items-center gap-1 ${severityLabels[selectedLog.severity]?.bg || 'bg-slate-100 text-slate-700'}`}>
                    <CheckCircle className="w-3 h-3" />
                    {severityLabels[selectedLog.severity]?.label || selectedLog.severity}
                  </span>
                </div>
              </div>

              {/* Description box */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-slate-500 block">شرح فعالیت انجام شده (GMP Note):</span>
                <div className="bg-amber-50/40 border border-amber-200/50 p-3 rounded-xl text-slate-700 text-xs leading-relaxed font-medium">
                  {selectedLog.description}
                </div>
              </div>

              {/* Reason for Change (GMP Necessity) */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-slate-500 block">دلیل رسمی تغییرات (Change Rationale):</span>
                <div className="bg-slate-50 border border-slate-200 p-3 rounded-xl text-slate-700 text-xs leading-relaxed font-medium">
                  {selectedLog.reason}
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
                  <div className="bg-slate-900 text-white p-4 rounded-xl space-y-3 border border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <FlaskConical className="w-4 h-4 text-blue-400" />
                        <span className="text-xs font-bold text-slate-200">جزئیات اختصاصی آزمایشگاه و وضعیت نمونه</span>
                      </div>
                      <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full font-mono">
                        {selectedLog.module} / {selectedLog.recordName}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-400 text-[10px] block">نام سورس / شرکت:</span>
                        <span className="font-bold text-white">{sourceName || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block">ماده اولیه (Material):</span>
                        <span className="font-bold text-white">{material || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block">کد آزمون / Test Name:</span>
                        <span className="font-mono text-amber-300 font-bold">{testName || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block">کاربر ثبت کننده:</span>
                        <span className="font-medium text-slate-200">{selectedLog.user}</span>
                      </div>
                    </div>

                    {(beforeResult || afterResult) && (
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-xs">
                        <div>
                          <span className="text-rose-300 text-[10px] block">نتیجه آزمایش (Before):</span>
                          <span className="font-mono text-rose-200 bg-rose-950/40 px-2 py-1 rounded block mt-0.5 text-[11px]">{beforeResult || 'نامشخص / تعریف اولیه'}</span>
                        </div>
                        <div>
                          <span className="text-emerald-300 text-[10px] block">نتیجه آزمایش (After):</span>
                          <span className="font-mono text-emerald-200 bg-emerald-950/40 px-2 py-1 rounded block mt-0.5 text-[11px]">{afterResult || 'حذف شده یا بدون تغییر'}</span>
                        </div>
                      </div>
                    )}

                    {(beforeStatus || afterStatus) && (
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-xs">
                        <div>
                          <span className="text-slate-400 text-[10px] block">وضعیت/تصمیم (Before):</span>
                          <span className="font-bold text-rose-300">{beforeStatus || 'N/A'}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 text-[10px] block">وضعیت/تصمیم (After):</span>
                          <span className="font-bold text-emerald-300">{afterStatus || 'N/A'}</span>
                        </div>
                      </div>
                    )}

                    {(prevCounters.reject !== undefined || newCounters.reject !== undefined) && (
                      <div className="pt-2 border-t border-slate-800 text-[11px] space-y-1">
                        <span className="text-slate-400 text-[10px] block">شمارنده‌های نتایج آزمایشگاه (Laboratory Counters):</span>
                        <div className="flex items-center justify-between bg-slate-950 p-2 rounded-lg text-slate-300 font-mono text-[10px]">
                          <div>
                            <span className="text-slate-500">قبلی: </span>
                            <span className="text-emerald-400">Pass: {prevCounters.pass ?? 0}</span> | <span className="text-amber-400">Cond: {prevCounters.conditional ?? 0}</span> | <span className="text-rose-400">Reject: {prevCounters.reject ?? 0}</span>
                          </div>
                          <div>
                            <span className="text-slate-500">جدید: </span>
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
                  <div className="bg-slate-900 text-white p-4 rounded-xl space-y-3 border border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-bold text-slate-200">جزئیات ارزیابی ریسک و FMEA</span>
                      </div>
                      <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-800 px-2 py-0.5 rounded-full font-mono">
                        {selectedLog.action} / {selectedLog.user}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-400 text-[10px] block">تامین‌کننده / سورس:</span>
                        <span className="font-bold text-white">{supplier || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px] block">ماده اولیه (Material):</span>
                        <span className="font-bold text-white">{material || 'N/A'}</span>
                      </div>
                    </div>

                    {/* RPN, SRI & Risk Level Comparison */}
                    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 text-xs text-center">
                      <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-slate-400 text-[10px] block">RPN (شاخص ریسک)</span>
                        <span className="font-mono text-rose-300 text-[11px] block">{prevRPN ?? '-'}</span>
                        <span className="font-mono text-emerald-400 font-bold text-xs">{newRPN ?? '-'}</span>
                      </div>
                      <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-slate-400 text-[10px] block">SRI (ریسک کل)</span>
                        <span className="font-mono text-rose-300 text-[11px] block">{prevSRI ?? '-'}</span>
                        <span className="font-mono text-emerald-400 font-bold text-xs">{newSRI ?? '-'}</span>
                      </div>
                      <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                        <span className="text-slate-400 text-[10px] block">سطح ریسک</span>
                        <span className="font-bold text-rose-300 text-[11px] block">{prevLevel ?? '-'}</span>
                        <span className="font-bold text-emerald-400 text-xs">{newLevel ?? '-'}</span>
                      </div>
                    </div>

                    {/* FMEA Parameter Changes */}
                    {(prevSev !== undefined || newSev !== undefined) && (
                      <div className="pt-2 border-t border-slate-800 text-[11px] space-y-1">
                        <span className="text-slate-400 text-[10px] block">پارامترهای FMEA (شدت، وقوع، تشخیص):</span>
                        <div className="grid grid-cols-3 gap-2 text-center font-mono text-[10px] bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                          <div>
                            <span className="text-slate-400 block">شدت (Severity)</span>
                            <span className="text-slate-300">{prevSev ?? '-'} &rarr; <strong className="text-amber-300">{newSev ?? '-'}</strong></span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">وقوع (Occurrence)</span>
                            <span className="text-slate-300">{prevOcc ?? '-'} &rarr; <strong className="text-amber-300">{newOcc ?? '-'}</strong></span>
                          </div>
                          <div>
                            <span className="text-slate-400 block">تشخیص (Detectability)</span>
                            <span className="text-slate-300">{prevDet ?? '-'} &rarr; <strong className="text-amber-300">{newDet ?? '-'}</strong></span>
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
                  <div className="bg-slate-900 text-white p-4 rounded-xl space-y-3 border border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <Calculator className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-bold text-slate-200">جزئیات محاسبه امتیاز SPS و رتبه‌بندی</span>
                      </div>
                      <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-2 py-0.5 rounded-full font-mono">
                        SPS Score Calculation
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                        <span className="text-slate-400 text-[10px] block">امتیاز کل SPS قبلی:</span>
                        <span className="font-mono text-rose-300 font-bold text-sm">{prevTotal} (Grade: {prevGrade})</span>
                      </div>
                      <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                        <span className="text-slate-400 text-[10px] block">امتیاز کل SPS جدید:</span>
                        <span className="font-mono text-emerald-400 font-bold text-sm">{newTotal} (Grade: {newGrade})</span>
                      </div>
                    </div>

                    {/* Department Breakdown */}
                    <div className="pt-2 border-t border-slate-800 space-y-1 text-[11px]">
                      <span className="text-slate-400 text-[10px] block">تفکیک امتیازات بخش‌های ارزیابی (Department Breakdown):</span>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-[10px] font-mono bg-slate-950 p-2 rounded-lg border border-slate-800">
                        <div>
                          <span className="text-slate-400 block">کیفیت QA (40%)</span>
                          <span className="text-slate-300">{prevQA} &rarr; <strong className="text-emerald-400">{newQA}</strong></span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">مالی (30%)</span>
                          <span className="text-slate-300">{prevFin} &rarr; <strong className="text-emerald-400">{newFin}</strong></span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">بازرگانی (20%)</span>
                          <span className="text-slate-300">{prevCom} &rarr; <strong className="text-emerald-400">{newCom}</strong></span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">انبار/برنامه‌ریزی (10%)</span>
                          <span className="text-slate-300">{prevPln} &rarr; <strong className="text-emerald-400">{newPln}</strong></span>
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
                  <div className="bg-slate-900 text-white p-4 rounded-xl space-y-3 border border-slate-800 shadow-xs">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <div className="flex items-center gap-2">
                        <Award className="w-4 h-4 text-purple-400" />
                        <span className="text-xs font-bold text-slate-200">تغییر خودکار جایگاه در جدول رتبه‌بندی (Supplier Ranking)</span>
                      </div>
                      <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-800 px-2 py-0.5 rounded-full font-mono">
                        SYSTEM / Auto-Recalculated
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <span className="text-slate-400 text-[10px] block">رتبه قبلی (Previous Rank):</span>
                        <span className="font-mono text-rose-400 font-extrabold text-lg">#{prevRank}</span>
                        <span className="text-slate-500 text-[10px] block font-mono">SPS: {prevSPS}</span>
                      </div>
                      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
                        <span className="text-slate-400 text-[10px] block">رتبه جدید (New Rank):</span>
                        <span className="font-mono text-emerald-400 font-extrabold text-lg">#{newRank}</span>
                        <span className="text-slate-500 text-[10px] block font-mono">SPS: {newSPS}</span>
                      </div>
                    </div>

                    <div className="text-[10px] text-slate-400 bg-slate-950 p-2 rounded-lg flex items-center justify-between border border-slate-800">
                      <span>دلیل محاسبه: {selectedLog.reason || 'SPS score recalculated'}</span>
                      <span className="text-purple-300 font-mono">Trigger Source: SYSTEM</span>
                    </div>
                  </div>
                );
              })()}
              <div className="space-y-3.5 pt-4 border-t border-slate-100">
                <span className="text-[11px] font-bold text-slate-500 block">بررسی مقایسه‌ای مقادیر (Before / After Comparison):</span>
                
                <div className="grid grid-cols-1 gap-3">
                  {/* Before values */}
                  <div className="bg-rose-50/30 border border-rose-100 rounded-xl p-3">
                    <span className="text-[10px] font-bold text-rose-600 block mb-1.5">مقادیر قبل از تغییر (Before)</span>
                    <div className="font-mono text-[11px] text-rose-800 bg-rose-50/50 p-2 rounded-lg overflow-x-auto text-left" dir="ltr">
                      {isLoadingDetail ? (
                        <div className="flex items-center gap-1 text-rose-400 py-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span className="italic">در حال بارگذاری تغییرات از دیتابیس...</span>
                        </div>
                      ) : selectedLog.before ? (
                        typeof selectedLog.before === 'object' ? (
                          <pre className="whitespace-pre-wrap">{JSON.stringify(selectedLog.before, null, 2)}</pre>
                        ) : (
                          <span>{selectedLog.before}</span>
                        )
                      ) : (
                        <span className="text-rose-400 italic">No existing record (تعریف اولیه)</span>
                      )}
                    </div>
                  </div>

                  {/* After values */}
                  <div className="bg-emerald-50/30 border border-emerald-100 rounded-xl p-3">
                    <span className="text-[10px] font-bold text-emerald-600 block mb-1.5">مقادیر بعد از تغییر (After)</span>
                    <div className="font-mono text-[11px] text-emerald-800 bg-emerald-50/50 p-2 rounded-lg overflow-x-auto text-left" dir="ltr">
                      {isLoadingDetail ? (
                        <div className="flex items-center gap-1 text-emerald-400 py-1">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span className="italic">در حال بارگذاری تغییرات از دیتابیس...</span>
                        </div>
                      ) : selectedLog.after ? (
                        typeof selectedLog.after === 'object' ? (
                          <pre className="whitespace-pre-wrap">{JSON.stringify(selectedLog.after, null, 2)}</pre>
                        ) : (
                          <span>{selectedLog.after}</span>
                        )
                      ) : (
                        <span className="text-emerald-400 italic">Record Deleted (حذف شده)</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Drawer Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 text-center shrink-0">
              <p className="text-[10px] text-slate-400 font-medium">انطباق تضمین کیفیت دارویی با دستورالعمل‌های ICH Q9 و ضوابط سازمان غذا و دارو (ALCOA+)</p>
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
};
