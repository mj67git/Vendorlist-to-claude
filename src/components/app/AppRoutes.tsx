import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { BusinessPartner, Category, Material, User, Vendor } from '../../types';
import { can, categoryPermission, VIEW_PERMISSIONS, type Permission } from '../../utils/permissions';
import type { TaskKey } from '../../utils/navRoutes';
import type { ViewState } from '../../utils/navStack';
import type { GatedVendorList } from '../../hooks/useGatedVendorList';
import { CategoryView } from '../views/CategoryView';
import { HomeView } from '../views/HomeView';
import { VendorForm } from '../vendor/VendorForm';
import { CategoryDenied, PermissionDenied } from '../AccessDenied';
import { Button } from '../ui/button';

/**
 * Pages that are not the page you land on.
 *
 * Each of these is a whole module — the audit trail with its filters and diff
 * view, the user administration screen, the partner repository — and a session
 * may well never open one. Loading them with the application meant every user
 * downloaded every module before seeing the dashboard.
 *
 * They are fetched when navigated to instead, behind the Suspense boundary in
 * `renderContent`. The views that ARE the landing surface — the dashboard, a
 * category list, a source's detail page and its form — stay in the main bundle
 * on purpose: splitting the common path only trades one wait for another.
 */
const SupplierAuditView = React.lazy(() => import('../../components/views/SupplierAuditView').then(m => ({ default: m.SupplierAuditView })));
const ArchiveView = React.lazy(() => import('../../components/views/ArchiveView').then(m => ({ default: m.ArchiveView })));
const AuditTrailView = React.lazy(() => import('../../components/AuditTrailView').then(m => ({ default: m.AuditTrailView })));
const UsersView = React.lazy(() => import('../../components/UsersView').then(m => ({ default: m.UsersView })));
const MaterialRepositoryView = React.lazy(() => import('../../components/MaterialRepositoryView').then(m => ({ default: m.MaterialRepositoryView })));
const BusinessPartnerRepositoryView = React.lazy(() => import('../../components/BusinessPartnerRepositoryView').then(m => ({ default: m.BusinessPartnerRepositoryView })));
const WorklistView = React.lazy(() => import('../../components/views/WorklistView').then(m => ({ default: m.WorklistView })));
/*
 * The source page joins them, for the library it draws with rather than for
 * its own size: it is the other eager importer of `recharts`, which is the
 * largest thing in the bundle and was therefore downloaded by everyone who
 * opened the dashboard, whether or not they ever opened a source.
 */
const VendorDetail = React.lazy(() => import('../../components/vendor/VendorDetail').then(m => ({ default: m.VendorDetail })));

/** What a page looks like while its code is on the way. */
function PageLoading() {
  return (
    <div className="w-full py-16 flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="w-8 h-8 rounded-full border-2 border-border border-t-primary animate-spin" aria-hidden />
      <p className="text-xs">در حال بارگذاری…</p>
    </div>
  );
}

/**
 * Which page the current location draws, and what it is allowed to draw.
 *
 * This is the router. It was the last ~300 lines of `App.tsx` that were not
 * either state or chrome, and it is the piece that decides both what to show
 * and — through `VIEW_PERMISSIONS` and `can()` — whether this account may see
 * it at all, which is exactly the pair worth being able to read in one place
 * (rule 14: the sidebar, this file and the server all read the same table).
 *
 * Deliberately a function that returns JSX rather than a component, and called
 * as `renderRoutes(ctx)`. A component would add a boundary the transition is
 * mounted inside: `AnimatePresence` and the `motion.div` keyed by the route are
 * *in here*, and page-to-page animation is the one thing in this application
 * that a stray remount would break silently.
 *
 * The context is destructured in one statement so that everything below it is
 * the code that was already here, unchanged.
 */
export interface RouteContext {
  view: ViewState['view'];
  categoryId: Category | null;
  formMode: 'create' | 'edit' | null;
  currentViewState: ViewState;
  selectedVendor: Vendor | null;
  pendingVendor: Vendor | null;
  vendorLinkPending: boolean;
  expandedMaterial: string | null;
  setExpandedMaterial: (mat: string | null) => void;
  currentUser: User | null;
  vendors: Vendor[];
  materials: Material[];
  businessPartners: BusinessPartner[];
  isSyncing: boolean;
  partnersLoading: boolean;
  gated: GatedVendorList;
  viewAccess: GatedVendorList['access'];
  setDataRevision: React.Dispatch<React.SetStateAction<number>>;
  navigate: (view: ViewState['view'], category?: Category | null, taskKey?: TaskKey | null) => void;
  handleSelectVendor: (vendor: Vendor | null) => void;
  goBack: () => void;
  openSourceForm: (mode: 'create' | 'edit', cat?: Category | null) => void;
  closeSourceForm: () => void;
  registerNavGuard: (fn: (() => boolean) | null) => void;
  navGuardRef: React.MutableRefObject<(() => boolean) | null>;
  historyRef: React.MutableRefObject<ViewState[]>;
  pendingNavRef: React.MutableRefObject<(() => void) | null>;
  setPendingNav: React.Dispatch<React.SetStateAction<(() => void) | null>>;
  replaceUrlRef: React.MutableRefObject<boolean>;
  handleAddVendor: (vendor: Vendor) => Promise<Vendor | null>;
  handleUpdateVendor: (vendor: Vendor, msg?: string | null) => void;
  handleDeleteVendor: (vendorId: string, reasonForChange?: string) => void;
  handleAddMaterial: (material: Material) => void;
  handleEditMaterial: (material: Material, customAction?: string) => void;
  handleDeleteMaterial: (id: string) => Promise<void> | void;
  handleAddBusinessPartner: (partner: BusinessPartner) => void;
  handleEditBusinessPartner: (partner: BusinessPartner) => void;
  handleDeleteBusinessPartner: (id: string) => void;
  /** Local mode only: the dashboard offers the JSON backup the header does. */
  handleDownloadBackup: () => void;
}

export function renderRoutes(ctx: RouteContext) {
  const {
    view, categoryId, formMode, currentViewState,
    selectedVendor, pendingVendor, vendorLinkPending,
    expandedMaterial, setExpandedMaterial,
    currentUser, vendors, materials, businessPartners,
    isSyncing, partnersLoading, gated, viewAccess, setDataRevision,
    navigate, handleSelectVendor, goBack, openSourceForm, closeSourceForm,
    registerNavGuard, navGuardRef, historyRef, pendingNavRef, setPendingNav, replaceUrlRef,
    handleAddVendor, handleUpdateVendor, handleDeleteVendor,
    handleAddMaterial, handleEditMaterial, handleDeleteMaterial,
    handleAddBusinessPartner, handleEditBusinessPartner, handleDeleteBusinessPartner,
    handleDownloadBackup,
  } = ctx;

    let content;
    let keyName = '';

    // Every page built from the source list shows the same refusal, so it is
    // written once here rather than repeated at each branch.
    const DENY_SOURCES = <PermissionDenied reason="sources" onHome={() => navigate('home')} />;
    // Held back until the server answers. Drawing the page first and replacing
    // it with a refusal a moment later would show it to somebody who may not
    // open it — briefly, but the data would have been on screen.
    const CHECKING_ACCESS = (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
        <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        <p className="text-xs font-semibold">در حال بررسی سطح دسترسی…</p>
      </div>
    );
    // A read that failed for a reason that is not a refusal. Saying "no access"
    // here would blame the administrator for a network fault; saying nothing
    // would draw an empty archive that looks like an empty register.
    const LOAD_FAILED = (
      <div className="p-8 max-w-xl mx-auto my-12 bg-card border border-border rounded-2xl text-center space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 flex items-center justify-center mx-auto">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-base font-black text-foreground">اطلاعات این نما خوانده نشد</h2>
        <p className="text-xs text-muted-foreground leading-relaxed font-medium">{gated.error}</p>
        <Button onClick={() => setDataRevision(n => n + 1)} className="text-xs font-bold">تلاش دوباره</Button>
      </div>
    );
    const DENY_ARCHIVE = <PermissionDenied reason="archive" onHome={() => navigate('home')} />;
    const DENY_DIRECTORY = <PermissionDenied reason="supplier-audit" onHome={() => navigate('home')} />;

    if (formMode) {
      // The source form as a full page: it is the longest form in the app and
      // opens dialogs of its own, so it gets the content area rather than an
      // overlay.
      const editing = formMode === 'edit' ? selectedVendor ?? undefined : undefined;
      keyName = `source-form-${formMode}-${editing?.id ?? categoryId ?? 'new'}`;
      // The form is a route, so hiding the button that opens it is not enough:
      // `#/category/foreign/new` is a link someone can be sent or can keep in
      // their history. Refusing here means an account without the permission
      // meets the refusal before filling the form in, rather than after — the
      // server has always refused the save itself (rule 14).
      const formPermission: Permission = formMode === 'edit' ? 'vendor.edit' : 'vendor.create';
      if (!can(currentUser, formPermission)) {
        keyName = `source-form-denied-${formMode}`;
        content = <PermissionDenied reason={formMode === 'edit' ? 'source-edit' : 'source-create'} onHome={() => navigate('home')} />;
      } else {
      content = (
        <VendorForm
          vendors={vendors}
          materials={materials}
          onAddMaterial={handleAddMaterial}
          categoryId={(editing?.category as Category) || (categoryId as Category) || 'domestic'}
          existingVendor={editing}
          onClose={goBack}
          /* Where the two footer buttons part company.
             They share one save; only what happens afterwards differs. A
             registration lands on the new source's own page, because that is
             where the work continues — department scores, risk assessment, the
             rest of the evaluation. «ذخیره و ثبت بعدی» never gets here: the
             form keeps itself and empties in place. An edit returns where it
             came from, which for a form opened off a record is that record.
             (This is why rule 8a now reads "a registration lands on its record":
             the batch button is what keeps bulk entry painless.) */
          onSaved={(saved) => {
            // This runs after the server answers, which can be after the user
            // has moved on. Registration goes to the new record because the
            // work continues there (rule 8a) — but only if the form is still
            // the page they are on. Jumping somebody who has already opened the
            // home page is the same interruption this callback exists to avoid
            // on every other save.
            const stack = historyRef.current;
            const stillOnForm = !!stack[stack.length - 1]?.formMode;
            if (!stillOnForm) return;
            // They pressed something while the save was in flight and the guard
            // stopped them with a dialog. The save has now landed, so the thing
            // they asked for is what happens — not a jump to the new record,
            // which would answer a question they did not ask.
            const waiting = pendingNavRef.current;
            if (waiting) {
              navGuardRef.current = null;
              setPendingNav(null);
              waiting();
              return;
            }
            if (saved && !editing) {
              // The record takes the form's place in the stack, so it takes its
              // place in the browser's history too — Back from here belongs to
              // whatever the user was doing before they opened the form.
              replaceUrlRef.current = true;
              handleSelectVendor(saved);
            } else {
              closeSourceForm();
            }
          }}
          onSave={(v, msg) => (editing ? handleUpdateVendor(v, msg) : handleAddVendor(v))}
          currentUser={currentUser}
          partners={businessPartners}
          onAddPartner={handleAddBusinessPartner}
          registerNavGuard={registerNavGuard}
        />
      );
      }
    } else if (vendorLinkPending) {
      // Deep link into a source: wait for the dataset, then report honestly if
      // the id is not in it.
      const stillLoading = isSyncing || vendors.length === 0;
      keyName = `vendor-pending-${pendingVendor!.id}`;
      content = stillLoading ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <div className="w-8 h-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          <p className="text-xs font-semibold">در حال بازیابی اطلاعات سورس…</p>
        </div>
      ) : (
        <div className="p-8 max-w-xl mx-auto my-12 bg-card border border-border rounded-2xl text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 flex items-center justify-center mx-auto">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-base font-black text-foreground">سورس مورد نظر یافت نشد</h2>
          <p className="text-xs text-muted-foreground leading-relaxed font-medium">
            لینکی که باز کرده‌اید به سورسی با شناسهٔ <span className="font-mono text-foreground">{pendingVendor!.id}</span> اشاره می‌کند که دیگر در سامانه وجود ندارد (احتمالاً حذف شده است).
          </p>
          <Button onClick={() => navigate('home')} className="text-xs font-bold">
            بازگشت به صفحه اصلی
          </Button>
        </div>
      );
    } else if (selectedVendor) {
      keyName = `vendor-${selectedVendor.id}`;
      content = <VendorDetail vendors={vendors} vendor={selectedVendor} onBack={goBack} onSave={handleUpdateVendor} onDelete={handleDeleteVendor} currentUser={currentUser} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} onAddPartner={handleAddBusinessPartner} registerNavGuard={registerNavGuard} onEditVendor={() => openSourceForm('edit')} />;
    } else {
      /*
       * One entry per page, instead of a chain of ten `else if` branches.
       *
       * The chain was 200 lines and every branch repeated the same three
       * decisions in its own words: which key the transition animates on,
       * which permission opens the page, and what to draw when it does not.
       * Written as a table those decisions line up and can be read down a
       * column — and a page added without a permission is now visibly a page
       * added without a permission.
       *
       * The permission is `VIEW_PERMISSIONS`, the same table the sidebar, the
       * command palette and the server read (rule 14). Nothing here is a
       * second opinion about who may see what.
       */
      const DASHBOARD = (
        <HomeView vendors={vendors} onNavigate={navigate} onSelectVendor={handleSelectVendor} onAddVendor={handleAddVendor} currentUser={currentUser} onDownloadBackup={handleDownloadBackup} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} onAddPartner={handleAddBusinessPartner} onOpenSourceForm={() => openSourceForm('create')} />
      );

      /**
       * The two views the server answers for.
       *
       * Both read their rows from `GET /api/vendors?view=…`, so the client
       * check is the UX half of a real answer: `denied` is the server's, and
       * `checking` holds the page back until it arrives rather than drawing it
       * and snatching it away (rule 14).
       */
      const serverGated = (denial: React.ReactNode, page: React.ReactNode) =>
        viewAccess === 'denied' ? denial
        : gated.error ? LOAD_FAILED
        : viewAccess === 'checking' ? CHECKING_ACCESS
        : page;

      const taskKey = (currentViewState.taskKey || 'eval') as TaskKey;

      const routes: Record<Exclude<ViewState['view'], 'category'>, { key: string; permission: Permission | null; denied: React.ReactNode; render: () => React.ReactNode }> = {
        home: {
          key: 'home',
          permission: null,
          denied: null,
          render: () => DASHBOARD,
        },
        archive: {
          key: 'archive',
          permission: VIEW_PERMISSIONS.archive,
          denied: DENY_ARCHIVE,
          render: () => serverGated(DENY_ARCHIVE, (
            <ArchiveView vendors={gated.rows} isLoading={gated.loading && gated.rows.length === 0} currentUser={currentUser} partners={businessPartners} materials={materials} onSelectVendor={handleSelectVendor} />
          )),
        },
        'supplier-audit': {
          key: 'supplier-audit',
          permission: VIEW_PERMISSIONS['supplier-audit'],
          denied: DENY_DIRECTORY,
          render: () => serverGated(DENY_DIRECTORY, (
            <SupplierAuditView vendors={gated.rows} isLoading={gated.loading && gated.rows.length === 0} onSelectVendor={handleSelectVendor} currentUser={currentUser} partners={businessPartners} materials={materials} onNavigate={navigate} />
          )),
        },
        tasks: {
          // The backlog is built from the source register, so it is gated on
          // reading sources rather than on a page permission of its own.
          key: `tasks-${taskKey}`,
          permission: 'vendor.read',
          denied: DENY_SOURCES,
          render: () => (
            <WorklistView
              taskKey={taskKey}
              vendors={vendors}
              partners={businessPartners}
              currentUser={currentUser}
              onSelectVendor={handleSelectVendor}
              onNavigate={navigate}
              onSwitchTask={k => navigate('tasks', null, k)}
            />
          ),
        },
        materials: {
          key: 'materials',
          permission: VIEW_PERMISSIONS.materials,
          denied: <PermissionDenied reason="materials" onHome={() => navigate('home')} />,
          render: () => (
            <MaterialRepositoryView
              materials={materials}
              onAddMaterial={handleAddMaterial}
              onEditMaterial={handleEditMaterial}
              onDeleteMaterial={handleDeleteMaterial}
              currentUser={currentUser}
              vendors={vendors}
              isLoading={isSyncing && materials.length === 0}
            />
          ),
        },
        'business-partners': {
          key: 'business-partners',
          permission: VIEW_PERMISSIONS['business-partners'],
          denied: <PermissionDenied reason="business-partners" onHome={() => navigate('home')} />,
          render: () => (
            <BusinessPartnerRepositoryView
              partners={businessPartners}
              onAddPartner={handleAddBusinessPartner}
              onEditPartner={handleEditBusinessPartner}
              onDeletePartner={handleDeleteBusinessPartner}
              currentUser={currentUser}
              vendors={vendors}
              // Not `&& length === 0`: with no cache the list falls back to the
              // bundled INITIAL_BUSINESS_PARTNERS_DB seed, so it is never empty
              // and the skeleton could never appear — the seed was being shown
              // as if it were the server's data while the real fetch was still
              // in flight.
              isLoading={partnersLoading}
            />
          ),
        },
        'audit-trail': {
          key: 'audit-trail',
          permission: VIEW_PERMISSIONS['audit-trail'],
          denied: <PermissionDenied reason="audit-trail" onHome={() => navigate('home')} />,
          render: () => <AuditTrailView currentUser={currentUser} />,
        },
        users: {
          // Opening the module is `users.read`: the list is what the page is,
          // and `GET /api/users` asks for exactly that. What an account can
          // then do inside it is decided button by button, by the permissions
          // the other user endpoints enforce.
          key: 'users',
          permission: VIEW_PERMISSIONS.users,
          denied: <PermissionDenied reason="users" onHome={() => navigate('home')} />,
          render: () => <UsersView currentUser={currentUser} />,
        },
      };

      if (view === 'category' && categoryId) {
        keyName = `category-${categoryId}`;
        content = !can(currentUser, categoryPermission(categoryId)) ? (
          categoryId === 'sample' || categoryId === 'blacklist'
            ? <CategoryDenied categoryId={categoryId} onHome={() => navigate('home')} />
            : DENY_SOURCES
        ) : <CategoryView vendors={vendors} isLoading={isSyncing && vendors.length === 0} categoryId={categoryId} onSelectVendor={handleSelectVendor} currentUser={currentUser} expandedMaterial={expandedMaterial} onToggleMaterial={setExpandedMaterial} materials={materials} onAddMaterial={handleAddMaterial} partners={businessPartners} />;
      } else {
        const route = routes[view as Exclude<ViewState['view'], 'category'>];
        if (!route) {
          // An address that decoded to no page at all. The dashboard is the
          // one page every signed-in account can open.
          keyName = 'home-fallback';
          content = DASHBOARD;
        } else if (route.permission && !can(currentUser, route.permission)) {
          keyName = `${route.key}-denied`;
          content = route.denied;
        } else {
          keyName = route.key;
          content = route.render();
        }
      }
    }

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={keyName}
          initial={{ opacity: 0, y: 10, filter: 'blur(2px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -10, filter: 'blur(2px)' }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="w-full h-full"
        >
          {/* The split-out pages arrive here. The fallback is deliberately
              quiet and roughly page-shaped: on a fast internal network it is
              one frame, and a spinner that flashes for one frame reads as a
              glitch rather than as progress. */}
          <React.Suspense fallback={<PageLoading />}>
            {content}
          </React.Suspense>
        </motion.div>
      </AnimatePresence>
    );
  }
