import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/mode-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { OrganizationSwitcher } from '@/components/OrganizationSwitcher';
import { Logo } from '@/components/Logo';
import { Calendar, Home, Users, Settings, Shield } from 'lucide-react';

interface LayoutProps {
  children: ReactNode;
}

/**
 * Application layout component that renders the top navigation bar and page content.
 *
 * Renders logo, primary navigation links, organization switcher, language and mode toggles, and a logout button.
 * The logout action removes 'token' and 'user' from localStorage and navigates to '/login'.
 * If the stored user has `is_super_admin` truthy, a Super Admin navigation item is included.
 *
 * @param children - Content to render inside the layout's main area.
 * @returns The layout element containing navigation and the provided children.
 */
export function Layout({ children }: LayoutProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  // Memoize user to prevent unnecessary re-renders
  const user = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}');
    } catch {
      return {};
    }
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b bg-card sticky top-0 z-50 text-foreground">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6 flex-1 min-w-0">
            <Logo />
            <div className="hidden md:flex items-center gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/dashboard">
                  <Home className="mr-2 h-4 w-4" />
                  {t('dashboard')}
                </Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/events">
                  <Calendar className="mr-2 h-4 w-4" />
                  {t('events')}
                </Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/users">
                  <Users className="mr-2 h-4 w-4" />
                  {t('users')}
                </Link>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/equipment">
                  <Settings className="mr-2 h-4 w-4" />
                  {t('equipment')}
                </Link>
              </Button>
              {user?.is_super_admin && (
                <Button variant="ghost" size="sm" asChild className="text-primary">
                  <Link to="/super-admin">
                    <Shield className="mr-2 h-4 w-4" />
                    {t('superAdmin')}
                  </Link>
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex flex-col items-end gap-0.5 text-sm min-w-0">
              <OrganizationSwitcher />
              <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                {user?.email}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <LanguageToggle />
              <ModeToggle />
              <Button variant="outline" size="sm" onClick={handleLogout}>
                {t('logout')}
              </Button>
            </div>
          </div>
        </div>
      </nav>
      <main>{children}</main>
    </div>
  );
}
