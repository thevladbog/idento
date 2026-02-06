import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

interface LogoProps {
  className?: string;
  linkTo?: string;
}

export function Logo({ className = '', linkTo = '/dashboard' }: LogoProps) {
  const { i18n } = useTranslation();
  
  const logoSrc = i18n.language === 'ru' ? '/logo-ru.svg' : '/logo-en.svg';
  const logoAlt = i18n.language === 'ru' ? 'Иденто' : 'Idento';

  return (
    <Link to={linkTo} className={`flex items-center ${className}`}>
      <img 
        src={logoSrc} 
        alt={logoAlt}
        className="h-8 w-auto transition-opacity hover:opacity-80"
      />
    </Link>
  );
}

