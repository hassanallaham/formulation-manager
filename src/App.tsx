import { useEffect, useState } from 'react';
import {
  Atom,
  Beaker,
  Coins,
  DatabaseBackup,
  FlaskConical,
  FolderTree,
  HardDriveUpload,
  KeyRound,
  LogOut,
  Menu,
  Moon,
  Package,
  Scale,
  Sun,
  Tag as TagIcon,
  Truck,
  X,
} from 'lucide-react';
import { AuthGate, ChangePasswordModal } from './components/AuthGate';
import { EntityModal } from './components/EntityModal';
import { apiFetch, setAuthToken } from './lib/api';
import type { Category, EntityType, RouteTarget } from './types';
import { DetailView } from './views/DetailView';
import { ListView } from './views/ListView';

const NAV_ITEMS: { entity: EntityType; label: string; icon: typeof FlaskConical }[] = [
  { entity: 'formulas', label: 'Formulas', icon: FlaskConical },
  { entity: 'ingredients', label: 'Ingredients', icon: Package },
  { entity: 'materials', label: 'Materials', icon: Atom },
  { entity: 'suppliers', label: 'Suppliers', icon: Truck },
  { entity: 'categories', label: 'Categories', icon: FolderTree },
  { entity: 'tags', label: 'Tags', icon: TagIcon },
  { entity: 'uploads', label: 'Uploads', icon: HardDriveUpload },
  { entity: 'units', label: 'Units', icon: Scale },
  { entity: 'currencies', label: 'Currencies', icon: Coins },
];

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('formulab_theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  const [authState, setAuthState] = useState<{
    loading: boolean;
    needsSetup: boolean;
    authenticated: boolean;
    user: { id: number; username: string } | null;
  }>({
    loading: true,
    needsSetup: false,
    authenticated: false,
    user: null,
  });

  const [route, setRoute] = useState<RouteTarget>({ entity: 'formulas' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [modalState, setModalState] = useState<{
    open: boolean;
    entity: EntityType;
    initialRecord?: any;
    defaultParentCategory?: { id: number; name: string } | null;
  } | null>(null);

  const [passwordModalOpen, setPasswordModalOpen] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem('formulab_theme', theme);
  }, [theme]);

  useEffect(() => {
    apiFetch<{
      needsSetup: boolean;
      authenticated: boolean;
      user: { id: number; username: string } | null;
    }>('/api/auth/status')
      .then((res) => {
        setAuthState({
          loading: false,
          needsSetup: res.needsSetup,
          authenticated: res.authenticated,
          user: res.user,
        });
      })
      .catch(() => {
        setAuthState({
          loading: false,
          needsSetup: false,
          authenticated: false,
          user: null,
        });
      });
  }, []);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    setAuthToken(null);
    setAuthState((prev) => ({ ...prev, authenticated: false, user: null }));
  };

  const navigate = (target: RouteTarget) => {
    setRoute(target);
    setSidebarOpen(false);
  };

  if (authState.loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-sm text-slate-500 dark:text-slate-400">
        Initializing FormuLab...
      </div>
    );
  }

  if (authState.needsSetup || !authState.authenticated) {
    return (
      <AuthGate
        needsSetup={authState.needsSetup}
        theme={theme}
        onToggleTheme={toggleTheme}
        onAuthenticated={(user) =>
          setAuthState({
            loading: false,
            needsSetup: false,
            authenticated: true,
            user,
          })
        }
      />
    );
  }

  const currentNav = NAV_ITEMS.find((n) => n.entity === route.entity);

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 flex flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 transition-transform duration-150 lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => navigate({ entity: 'formulas' })}
            className="flex items-center gap-2.5 text-left"
          >
            <Beaker className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" />
            <span className="text-base font-bold tracking-tight whitespace-nowrap">
              FormuLab
            </span>
          </button>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 lg:hidden"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = route.entity === item.entity;
            return (
              <button
                key={item.entity}
                type="button"
                onClick={() => navigate({ entity: item.entity })}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-800 dark:text-teal-300 font-medium'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-1 text-xs">
          <a
            href="/api/system/backup"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            <DatabaseBackup className="w-4 h-4 shrink-0" />
            <span>Backup Database</span>
          </a>
          <button
            type="button"
            onClick={() => setPasswordModalOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            <KeyRound className="w-4 h-4 shrink-0" />
            <span>Change Password</span>
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-slate-600 dark:text-slate-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-300 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Sign Out ({authState.user?.username})</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="w-4 h-4" />
            </button>

            <nav className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 truncate">
              <button
                type="button"
                onClick={() => navigate({ entity: route.entity })}
                className="font-medium text-slate-700 dark:text-slate-200 hover:underline whitespace-nowrap"
              >
                {currentNav?.label}
              </button>
              {route.id && (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    #{route.id}
                  </span>
                </>
              )}
            </nav>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            {theme === 'dark' ? (
              <Sun className="w-3.5 h-3.5" />
            ) : (
              <Moon className="w-3.5 h-3.5" />
            )}
            <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        </header>

        <main className="flex-1 p-5 sm:p-6 max-w-7xl w-full mx-auto">
          {route.id ? (
            <DetailView
              entity={route.entity}
              id={route.id}
              refreshKey={refreshKey}
              onNavigate={navigate}
              onEdit={(record) =>
                setModalState({
                  open: true,
                  entity: route.entity,
                  initialRecord: record,
                })
              }
              onDeleted={(entity) => {
                setRefreshKey((k) => k + 1);
                navigate({ entity });
              }}
            />
          ) : (
            <ListView
              entity={route.entity}
              refreshKey={refreshKey}
              onNavigate={navigate}
              onCreate={(defaultParentCategory?: Category) =>
                setModalState({
                  open: true,
                  entity: route.entity,
                  defaultParentCategory: defaultParentCategory
                    ? { id: defaultParentCategory.id, name: defaultParentCategory.name }
                    : null,
                })
              }
            />
          )}
        </main>
      </div>

      {modalState?.open && (
        <EntityModal
          entity={modalState.entity}
          initialRecord={modalState.initialRecord}
          defaultParentCategory={modalState.defaultParentCategory}
          onClose={() => setModalState(null)}
          onSaved={(saved) => {
            const targetEntity = modalState.entity;
            const wasCreate = !modalState.initialRecord?.id;
            setModalState(null);
            setRefreshKey((k) => k + 1);
            if (wasCreate && saved?.id) {
              navigate({ entity: targetEntity, id: saved.id });
            }
          }}
          onNavigate={navigate}
        />
      )}

      {passwordModalOpen && (
        <ChangePasswordModal onClose={() => setPasswordModalOpen(false)} />
      )}
    </div>
  );
}
