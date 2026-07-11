export function isActiveNavPath(itemPath: string, pathname: string): boolean {
  if (itemPath === '/super-admin') return pathname === itemPath;
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}
