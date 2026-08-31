import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { severityMatches } from "./auditTaxonomy.js";

// Types for Audit Log Service
export interface AuditLogFilters {
  userId?: string;
  /** Matches either the stored userId or the stored userName (the filter form offers names). */
  user?: string;
  module?: string;
  /** Coarse event group, expanded to a set of module values by the caller. */
  modules?: string[];
  eventType?: string;
  action?: 'Create' | 'Update' | 'Delete' | 'Restore' | 'Archive' | 'System Update' | 'System Calculation' | 'LOGIN' | 'LOGOUT' | 'FAILED_LOGIN' | 'ROLE_CHANGE' | 'PERMISSION_CHANGE' | 'CREATE_USER' | 'UPDATE_USER' | 'DELETE_USER' | string;
  severity?: 'Information' | 'Warning' | 'Critical' | string;
  entityId?: string;
  correlationId?: string;
  startDate?: Date;
  endDate?: Date;
  quickFilter?: 'lab_events' | 'sample_status' | 'system_generated' | 'reject_events' | 'risk_events' | 'fmea_changes' | 'score_changes' | 'ranking_changes' | 'system_calculations' | 'user_activity' | 'authentication' | 'authorization' | 'security_events' | string;
}

export interface CreateAuditInput {
  auditId: string;
  correlationId?: string;
  userId?: string;
  userName?: string;
  role?: string;
  module: string;
  eventType?: 'User Activity' | 'Authentication' | 'Authorization' | 'Security' | string;
  ipAddress?: string;
  userAgent?: string;
  entityType?: string;
  entityId?: string;
  entityName?: string;
  action: string;
  severity: 'Information' | 'Warning' | 'Critical' | string;
  description?: string;
  reasonForChange?: string;
  beforeData?: any;
  afterData?: any;
}

function isValidPostgresUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string" || !url.trim()) return false;
  const trimmed = url.trim();
  if (
    trimmed.includes("username:password") ||
    trimmed.includes(":port") ||
    trimmed.includes("host:port") ||
    trimmed.includes("database_name") ||
    trimmed.includes("user:password@host")
  ) {
    return false;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
      return false;
    }
    if (!parsed.hostname || parsed.hostname === "host" || parsed.hostname === "localhost.invalid") {
      return false;
    }
    if (parsed.port && (isNaN(Number(parsed.port)) || Number(parsed.port) <= 0 || Number(parsed.port) > 65535)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

let _prismaInstance: PrismaClient | null = null;

function getPrismaClient(): PrismaClient | null {
  if (typeof window !== "undefined") {
    return null;
  }
  if (!isValidPostgresUrl(process.env.DATABASE_URL)) {
    return null;
  }
  if (!_prismaInstance) {
    try {
      _prismaInstance = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
      });
      console.log("[Prisma] AuditService lazily initialized PrismaClient.");
    } catch (err: any) {
      console.error("[Prisma] AuditService failed to instantiate PrismaClient:", err.message);
      _prismaInstance = null;
    }
  }
  return _prismaInstance;
}

// PostgreSQL is the single source of truth for the audit trail. Fail fast
// instead of silently persisting to a local JSON file.
function requirePrisma(): PrismaClient {
  const prisma = getPrismaClient();
  if (!prisma) {
    throw new Error(
      "DATABASE_URL is missing or invalid. A valid PostgreSQL connection is required for the audit trail.",
    );
  }
  return prisma;
}

// Legacy JSON helpers retained only for the now-unreachable fallback branches
// below; PostgreSQL is required, so these are never exercised at runtime.
function getJsonDbPath(): string {
  return path.join(process.cwd(), "database", "audit_logs_v3.json");
}

function getJsonLogs(): any[] {
  try {
    const dbPath = getJsonDbPath();
    if (!fs.existsSync(dbPath)) {
      return [];
    }
    const data = fs.readFileSync(dbPath, "utf-8");
    return JSON.parse(data) || [];
  } catch (err) {
    console.warn("[AuditService] Failed to load JSON audit logs:", err);
    return [];
  }
}

function saveJsonLogs(logs: any[]): void {
  try {
    const dbPath = getJsonDbPath();
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dbPath, JSON.stringify(logs, null, 2), "utf-8");
  } catch (err) {
    console.error("[AuditService] Failed to write JSON audit logs:", err);
  }
}

export class AuditService {
  /**
   * Alias for logging events with flexible payload
   */
  public static async logEvent(logData: any): Promise<any> {
    return this.createAuditRecord({
      auditId: logData.auditId || 'aud_' + Math.random().toString(36).substring(2, 10),
      userId: logData.userId,
      userName: logData.userName,
      role: logData.role,
      module: logData.module || 'System',
      action: logData.action || 'Log',
      entityType: logData.entityType,
      entityId: logData.entityId,
      entityName: logData.entityName,
      severity: logData.severity === 'high' ? 'Critical' : logData.severity === 'medium' ? 'Warning' : 'Information',
      description: logData.description,
      reasonForChange: logData.reasonForChange,
      beforeData: logData.beforeValue,
      afterData: logData.afterValue,
      ipAddress: logData.ipAddress,
      userAgent: logData.userAgent
    });
  }

  /**
   * Create a new audit log record
   */
  public static async createAuditRecord(input: CreateAuditInput): Promise<any> {
    const prisma = requirePrisma();
    const now = new Date();

    if (!prisma) {
      const logs = getJsonLogs();
      const record = {
        id: "aud_v3_" + Math.random().toString(36).substring(2, 11),
        auditId: input.auditId,
        correlationId: input.correlationId || null,
        timestamp: now.toISOString(),
        userId: input.userId || null,
        userName: input.userName || null,
        role: input.role || null,
        module: input.module,
        eventType: input.eventType || "User Activity",
        ipAddress: input.ipAddress || null,
        userAgent: input.userAgent || null,
        entityType: input.entityType || null,
        entityId: input.entityId || null,
        entityName: input.entityName || null,
        action: input.action,
        severity: input.severity,
        description: input.description || null,
        reasonForChange: input.reasonForChange || null,
        beforeData: input.beforeData || null,
        afterData: input.afterData || null,
        createdAt: now.toISOString(),
      };
      logs.unshift(record); // newest first
      saveJsonLogs(logs);
      console.log(`[AuditService][JSON] Created Audit Record: ${input.auditId}`);
      return record;
    }

    try {
      // Metadata about the event goes in its own columns, never into the change
      // data. Folding ip/device/eventType into `afterData` made them show up as
      // "added fields" in the before/after comparison of every record — noise on
      // top of the one thing a reviewer opens that panel to see.
      const afterData = input.afterData;

      const record = await prisma.auditLog.create({
        data: {
          auditId: input.auditId,
          correlationId: input.correlationId || null,
          userId: input.userId || null,
          userName: input.userName || null,
          role: input.role || null,
          module: input.module,
          entityType: input.entityType || null,
          entityId: input.entityId || null,
          entityName: input.entityName || null,
          action: input.action,
          severity: input.severity,
          description: input.description || null,
          reasonForChange: input.reasonForChange || null,
          beforeData: input.beforeData || null,
          afterData: afterData || null,
          ipAddress: input.ipAddress || null,
          userAgent: input.userAgent || null,
          eventType: input.eventType || null,
        }
      });
      console.log(`[AuditService] Successfully persisted audit record to PostgreSQL: ${record.auditId}`);
      return record;
    } catch (err: any) {
      console.error("[AuditService] Failed to persist audit record:", err.message);
      throw err;
    }
  }

  /**
   * Retrieve multiple audit logs with optional filters and pagination
   */
  /**
   * Translate the table's sort choice into an `orderBy`.
   *
   * The column headers used to be decorative: the view kept `sortField` and
   * `sortDirection` in state, drew an arrow from them, and never sent them
   * anywhere — every page came back ordered by timestamp regardless. On an
   * audit trail, a control that claims an order it does not apply is worse
   * than no control.
   *
   * Sorting has to happen here rather than in the browser because the list is
   * paginated server-side: ordering the ten rows on screen would only ever
   * sort the page, not the log.
   *
   * `timestamp` is always the tie-breaker so equal keys keep a stable,
   * meaningful order.
   */
  private static orderFor(sortBy?: string, sortDir?: string) {
    const dir = sortDir === 'asc' ? 'asc' : 'desc';
    switch (sortBy) {
      case 'user': return [{ userName: dir }, { timestamp: 'desc' as const }];
      // Severity is deliberately not offered: the column stores free text with
      // two spellings for one level (`Info`/`Information`, see auditTaxonomy),
      // so a text sort would put "Critical" next to "Information" and read as
      // an order that means nothing. Severity is a filter instead.
      case 'date':
      default: return [{ timestamp: dir }];
    }
  }

  public static async getAuditLogs(
    filters?: AuditLogFilters,
    page: number = 1,
    limit: number = 20,
    sort?: { by?: string; dir?: string }
  ): Promise<{ data: any[]; total: number }> {
    const prisma = requirePrisma();
    if (!prisma) {
      let logs = getJsonLogs();
      
      // Apply filters
      if (filters) {
        if (filters.userId) {
          logs = logs.filter(l => l.userId === filters.userId);
        }
        if (filters.module && filters.module !== "all") {
          logs = logs.filter(l => l.module === filters.module);
        }
        if (filters.eventType && filters.eventType !== "all") {
          logs = logs.filter(l => l.eventType === filters.eventType || l.module === filters.eventType);
        }
        if (filters.action && filters.action !== "all") {
          logs = logs.filter(l => l.action === filters.action);
        }
        if (filters.severity && filters.severity !== "all") {
          logs = logs.filter(l => l.severity.toLowerCase() === filters.severity.toLowerCase());
        }
        if (filters.entityId) {
          logs = logs.filter(l => l.entityId === filters.entityId);
        }
        if (filters.correlationId) {
          logs = logs.filter(l => l.correlationId === filters.correlationId);
        }
        if (filters.startDate) {
          const sTime = new Date(filters.startDate).getTime();
          logs = logs.filter(l => new Date(l.timestamp).getTime() >= sTime);
        }
        if (filters.endDate) {
          const eTime = new Date(filters.endDate).getTime();
          logs = logs.filter(l => new Date(l.timestamp).getTime() <= eTime);
        }
        if (filters.quickFilter && filters.quickFilter !== "all") {
          const qf = filters.quickFilter.toLowerCase();
          if (qf === "user_activity") {
            logs = logs.filter(l => 
              l.eventType === "User Activity" || 
              l.module === "مدیریت کاربران" || 
              l.module === "User Management" ||
              ['CREATE_USER', 'UPDATE_USER', 'DELETE_USER', 'Create', 'Update', 'Delete'].includes(l.action)
            );
          } else if (qf === "authentication") {
            logs = logs.filter(l => 
              l.eventType === "Authentication" || 
              l.module === "احراز هویت" || 
              l.module === "Authentication" ||
              ['LOGIN', 'LOGOUT', 'FAILED_LOGIN', 'Login'].includes(l.action)
            );
          } else if (qf === "authorization") {
            logs = logs.filter(l => 
              l.eventType === "Authorization" || 
              ['ROLE_CHANGE', 'PERMISSION_CHANGE'].includes(l.action)
            );
          } else if (qf === "security_events") {
            logs = logs.filter(l => 
              l.eventType === "Security" || 
              l.entityType === "Security Event" || 
              ['LOGIN', 'LOGOUT', 'FAILED_LOGIN', 'ROLE_CHANGE', 'PERMISSION_CHANGE'].includes(l.action) ||
              l.severity === "Critical"
            );
          } else if (qf === "lab_events" || qf === "laboratory") {
            logs = logs.filter(l => 
              l.module === "Laboratory" || 
              l.module === "آزمایشگاه کنترل کیفیت" || 
              l.entityType === "Laboratory Result" || 
              l.entityType === "آزمایشگاه" ||
              (l.description && l.description.includes("آزمایش"))
            );
          } else if (qf === "sample_status") {
            logs = logs.filter(l => 
              l.module === "Source Management" || 
              l.module === "مدیریت سورس‌ها" ||
              (l.description && (l.description.includes("وضعیت") || l.description.includes("Sample Status") || l.description.includes("سورس"))) ||
              (l.reasonForChange && l.reasonForChange.includes("Sample Status"))
            );
          } else if (qf === "system_generated") {
            logs = logs.filter(l => 
              l.action === "System Update" || 
              l.userId === "system" || 
              l.userName === "سیستم" ||
              (l.description && l.description.includes("خودکار")) ||
              (l.reasonForChange && l.reasonForChange.includes("automatically"))
            );
          } else if (qf === "reject_events") {
            logs = logs.filter(l => 
              l.severity?.toLowerCase() === "critical" || 
              l.action === "Reject" ||
              (l.description && (l.description.includes("مردود") || l.description.includes("Reject") || l.description.includes("OOS")))
            );
          } else if (qf === "risk_events") {
            logs = logs.filter(l => 
              l.module === "Risk Assessment" || 
              l.entityType === "Risk Assessment" || 
              l.entityType === "FMEA" ||
              (l.description && (l.description.includes("ریسک") || l.description.includes("Risk") || l.description.includes("FMEA")))
            );
          } else if (qf === "fmea_changes") {
            logs = logs.filter(l => 
              l.entityType === "FMEA" || 
              (l.description && (l.description.includes("FMEA") || l.description.includes("RPN") || l.description.includes("SRI")))
            );
          } else if (qf === "score_changes") {
            logs = logs.filter(l => 
              l.entityType === "Score" || 
              (l.description && (l.description.includes("امتیاز") || l.description.includes("SPS") || l.description.includes("ارزیابی")))
            );
          } else if (qf === "ranking_changes") {
            logs = logs.filter(l => 
              l.entityType === "Ranking" || 
              (l.description && (l.description.includes("رتبه") || l.description.includes("Rank") || l.description.includes("رتبه‌بندی")))
            );
          } else if (qf === "system_calculations") {
            logs = logs.filter(l => 
              l.action === "System Calculation" || 
              l.action === "System Update" ||
              (l.reasonForChange && (l.reasonForChange.toLowerCase().includes("recalculated") || l.reasonForChange.toLowerCase().includes("automatically"))) ||
              (l.description && (l.description.includes("محاسبه") || l.description.includes("خودکار")))
            );
          }
        }
      }

      // Sort: newest first
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const total = logs.length;
      const skip = (page - 1) * limit;
      const data = logs.slice(skip, skip + limit);

      return { data, total };
    }

    try {
      const skip = (page - 1) * limit;
      const where: any = {};

      if (filters) {
        if (filters.userId) where.userId = filters.userId;
        if (filters.user) where.OR = [{ userId: filters.user }, { userName: filters.user }];
        if (filters.module && filters.module !== "all") where.module = filters.module;
        else if (filters.modules && filters.modules.length) where.module = { in: filters.modules };
        if (filters.action && filters.action !== "all") where.action = filters.action;
        // `Info` and `Information` are the same level; see auditTaxonomy.ts.
        if (filters.severity && filters.severity !== "all") where.severity = { in: severityMatches(filters.severity) };
        if (filters.entityId) where.entityId = filters.entityId;
        if (filters.correlationId) where.correlationId = filters.correlationId;

        if (filters.startDate || filters.endDate) {
          where.timestamp = {};
          if (filters.startDate) where.timestamp.gte = filters.startDate;
          if (filters.endDate) where.timestamp.lte = filters.endDate;
        }
      }

      const [data, total] = await Promise.all([
        prisma.auditLog.findMany({
          where,
          orderBy: this.orderFor(sort?.by, sort?.dir) as any,
          skip,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ]);

      return { data, total };
    } catch (err: any) {
      console.error("[AuditService] Failed to retrieve audit logs from PostgreSQL:", err.message);
      throw err;
    }
  }

  /**
   * Retrieve a single audit log by its unique Prisma ID or Audit ID
   */
  public static async getAuditById(id: string): Promise<any | null> {
    const prisma = requirePrisma();
    if (!prisma) {
      const logs = getJsonLogs();
      return logs.find(l => l.id === id || l.auditId === id) || null;
    }

    try {
      const log = await prisma.auditLog.findFirst({
        where: {
          OR: [
            { id: id },
            { auditId: id }
          ]
        }
      });
      return log;
    } catch (err: any) {
      console.error("[AuditService] Failed to retrieve audit by ID:", err.message);
      throw err;
    }
  }

  /**
   * Retrieve full audit change history for a specific business entity (e.g. material or vendor)
   */
  public static async getEntityHistory(entityId: string, entityType?: string): Promise<any[]> {
    const prisma = requirePrisma();
    if (!prisma) {
      let logs = getJsonLogs();
      logs = logs.filter(l => l.entityId === entityId);
      if (entityType) {
        logs = logs.filter(l => l.entityType === entityType);
      }
      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return logs;
    }

    try {
      const where: any = { entityId };
      if (entityType) {
        where.entityType = entityType;
      }

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: "desc" }
      });
      return logs;
    } catch (err: any) {
      console.error("[AuditService] Failed to retrieve entity history:", err.message);
      throw err;
    }
  }

  /**
   * Search audit logs with a search text query and filters
   */
  public static async searchAuditLogs(
    query: string,
    filters?: AuditLogFilters,
    sort?: { by?: string; dir?: string }
  ): Promise<any[]> {
    const prisma = requirePrisma();
    if (!prisma) {
      let logs = getJsonLogs();

      if (filters) {
        if (filters.userId) logs = logs.filter(l => l.userId === filters.userId);
        if (filters.module && filters.module !== "all") logs = logs.filter(l => l.module === filters.module);
        if (filters.action && filters.action !== "all") logs = logs.filter(l => l.action === filters.action);
        if (filters.severity && filters.severity !== "all") logs = logs.filter(l => l.severity.toLowerCase() === filters.severity.toLowerCase());
        if (filters.entityId) logs = logs.filter(l => l.entityId === filters.entityId);
        if (filters.correlationId) logs = logs.filter(l => l.correlationId === filters.correlationId);
      }

      if (query && query.trim()) {
        const q = query.toLowerCase();
        logs = logs.filter(l => 
          (l.userName && l.userName.toLowerCase().includes(q)) ||
          (l.module && l.module.toLowerCase().includes(q)) ||
          (l.entityName && l.entityName.toLowerCase().includes(q)) ||
          (l.description && l.description.toLowerCase().includes(q)) ||
          (l.reasonForChange && l.reasonForChange.toLowerCase().includes(q))
        );
      }

      logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return logs.slice(0, 100);
    }

    try {
      const where: any = {};

      if (filters) {
        if (filters.userId) where.userId = filters.userId;
        // AND, not OR: the free-text search below claims `where.OR` for itself,
        // and the two conditions must both hold rather than either one.
        if (filters.user) {
          where.AND = [{ OR: [{ userId: filters.user }, { userName: filters.user }] }];
        }
        if (filters.module && filters.module !== "all") where.module = filters.module;
        else if (filters.modules && filters.modules.length) where.module = { in: filters.modules };
        if (filters.action && filters.action !== "all") where.action = filters.action;
        if (filters.severity && filters.severity !== "all") where.severity = { in: severityMatches(filters.severity) };
        if (filters.entityId) where.entityId = filters.entityId;
        if (filters.correlationId) where.correlationId = filters.correlationId;
        // The date range used to be dropped here, so searching by text inside a
        // date range quietly widened the range to "everything".
        if (filters.startDate || filters.endDate) {
          where.timestamp = {};
          if (filters.startDate) where.timestamp.gte = filters.startDate;
          if (filters.endDate) where.timestamp.lte = filters.endDate;
        }
      }

      if (query && query.trim()) {
        where.OR = [
          { userName: { contains: query, mode: "insensitive" } },
          { module: { contains: query, mode: "insensitive" } },
          { entityName: { contains: query, mode: "insensitive" } },
          { description: { contains: query, mode: "insensitive" } },
          { reasonForChange: { contains: query, mode: "insensitive" } },
        ];
      }

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: this.orderFor(sort?.by, sort?.dir) as any,
        take: 100,
      });

      return logs;
    } catch (err: any) {
      console.error("[AuditService] Failed to search audit logs from PostgreSQL:", err.message);
      throw err;
    }
  }
}
