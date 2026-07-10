import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, Building2, ClipboardList, FileText, Search, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { LanguageToggle } from '@/components/language-toggle';
import { ModeToggle } from '@/components/mode-toggle';
import { ImpersonationBanner } from '@/components/ImpersonationBanner';

export function isActiveNavPath(itemPath: string, pathname: string): boolean {
  if (itemPath === '/super-admin') return pathname === itemPath;
  return pathname.startsWith(itemPath);
}

export default function SuperAdminLayout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');

  const menuItems = [
    { icon: BarChart3, label: t('dashboard'), path: '/super-admin' },
    { icon: Building2, label: t('organizations'), path: '/super-admin/organizations' },
    { icon: FileText, label: t('subscriptionPlans'), path: '/super-admin/plans' },
    { icon: Users, label: t('allUsers'), path: '/super-admin/users' },
    { icon: ClipboardList, label: t('auditLog'), path: '/super-admin/audit' },
  ];

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    navigate(q ? `/super-admin/organizations?q=${encodeURIComponent(q)}` : '/super-admin/organizations');
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('current_tenant');
    navigate('/login');
  }

  let user: { email?: string } = {};
  try {
    user = JSON.parse(localStorage.getItem('user') || '{}');
  } catch {
    user = {};
  }
  const initials = (user.email || '?').slice(0, 2).toUpperCase();

  return (
    <div className="flex flex-col h-screen bg-background">
      <ImpersonationBanner />
      <header className="flex items-center gap-4 border-b border-black/10 bg-console-chrome px-4 py-2 text-console-chrome-foreground">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            И
          </div>
          <span className="font-semibold">Idento</span>
          <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] tracking-wide text-primary">
            {t('platformConsole')}
          </span>
        </div>
        <nav className="flex items-center gap-1">
          {menuItems.map((item) => {
            const active = isActiveNavPath(item.path, pathname);
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-console-chrome-active text-console-chrome-foreground'
                    : 'text-console-chrome-muted-foreground hover:text-console-chrome-foreground'
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <form onSubmit={handleSearchSubmit} className="ml-4 flex flex-1 items-center">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-console-chrome-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchTenantsPlaceholder')}
              className="h-8 border-white/10 bg-white/5 pl-8 text-sm text-console-chrome-foreground placeholder:text-console-chrome-muted-foreground focus-visible:ring-primary"
            />
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-console-chrome-muted-foreground">
              ⌘K
            </kbd>
          </div>
        </form>
        <div className="flex items-center gap-3">
          <ModeToggle />
          <LanguageToggle />
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
            title={user.email}
          >
            {initials}
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout} className="border-white/20 bg-transparent text-console-chrome-foreground hover:bg-white/10">
            {t('logout')}
          </Button>
        </div>
      </header>
      <main className="flex-1 overflow-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
}
