export function isActiveNavPath(itemPath: string, pathname: string): boolean {
  // The dashboard/index item ("/", relative to the app's basename) must
  // match exactly — otherwise it would prefix-match every other route too.
  if (itemPath === '/') return pathname === itemPath;
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}
