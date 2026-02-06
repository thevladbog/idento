import i18n from '@/i18n';

/**
 * Format date and time according to the current locale
 */
export const formatDateTime = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const locale = i18n.language === 'ru' ? 'ru-RU' : 'en-US';
  
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(dateObj);
};

/**
 * Format date only (without time)
 */
export const formatDate = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const locale = i18n.language === 'ru' ? 'ru-RU' : 'en-US';
  
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(dateObj);
};

/**
 * Format time only (without date)
 */
export const formatTime = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const locale = i18n.language === 'ru' ? 'ru-RU' : 'en-US';
  
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(dateObj);
};

/**
 * Format relative time (e.g., "2 hours ago")
 */
export const formatRelativeTime = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  const locale = i18n.language === 'ru' ? 'ru-RU' : 'en-US';
  
  if (diffSec < 60) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diffSec, 'second');
  } else if (diffMin < 60) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diffMin, 'minute');
  } else if (diffHour < 24) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diffHour, 'hour');
  } else if (diffDay < 30) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diffDay, 'day');
  } else {
    return formatDateTime(date);
  }
};

/**
 * Format date for display in a user-friendly way
 * Shows relative time for recent dates, full date/time for older ones
 */
export const formatDateSmart = (date: string | Date | null | undefined): string => {
  if (!date) return '-';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - dateObj.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  
  // If less than 24 hours ago, show relative time
  if (diffHours < 24 && diffHours > 0) {
    return formatRelativeTime(date);
  }
  
  // Otherwise show full date/time
  return formatDateTime(date);
};

