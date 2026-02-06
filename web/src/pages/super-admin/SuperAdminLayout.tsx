import { Link, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield, Building2, Users, BarChart3, FileText, Settings, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/mode-toggle';
import { LanguageToggle } from '@/components/language-toggle';

export default function SuperAdminLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const menuItems = [
    { icon: BarChart3, label: t('dashboard'), path: '/super-admin' },
    { icon: Building2, label: t('organizations'), path: '/super-admin/organizations' },
    { icon: Users, label: t('allUsers'), path: '/super-admin/users' },
    { icon: FileText, label: t('subscriptionPlans'), path: '/super-admin/plans' },
    { icon: BarChart3, label: t('analytics'), path: '/super-admin/analytics' },
    { icon: Settings, label: t('auditLog'), path: '/super-admin/audit' },
  ];

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('current_tenant');
    navigate('/login');
  };

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card">
        <div className="p-4 flex items-center gap-2 border-b">
          <Shield className="h-6 w-6 text-primary" />
          <h1 className="font-bold text-xl">{t('superAdmin')}</h1>
        </div>
        <nav className="p-4 space-y-2">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent transition-colors"
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          ))}
          
          <div className="pt-4 mt-4 border-t">
            <Link
              to="/dashboard"
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
            >
              <Home className="h-5 w-5" />
              {t('backToUserDashboard')}
            </Link>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="border-b bg-card px-6 py-3 flex items-center justify-between">
          <h2 className="text-sm text-muted-foreground">
            {t('superAdminPanel')}
          </h2>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground hidden sm:inline">
              {user?.email}
            </span>
            <LanguageToggle />
            <ModeToggle />
            <Button variant="outline" size="sm" onClick={handleLogout}>
              {t('logout')}
            </Button>
          </div>
        </header>

        {/* Content area */}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

