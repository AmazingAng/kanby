const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? '';

export const appBasePath = configuredBasePath.replace(/\/$/, '');

export function withAppBasePath(path: string, basePath: string): string {
  const normalizedBasePath = basePath.trim().replace(/\/$/, '');
  if (
    !normalizedBasePath ||
    path === normalizedBasePath ||
    path.startsWith(`${normalizedBasePath}/`) ||
    path.startsWith(`${normalizedBasePath}?`) ||
    path.startsWith(`${normalizedBasePath}#`)
  )
    return path;
  return `${normalizedBasePath}${path.startsWith('/') ? path : `/${path}`}`;
}

export function withoutAppBasePath(pathname: string, basePath: string): string {
  const normalizedBasePath = basePath.trim().replace(/\/$/, '');
  if (!normalizedBasePath) return pathname;
  if (pathname === normalizedBasePath) return '/';
  if (!pathname.startsWith(`${normalizedBasePath}/`)) return pathname;
  return pathname.slice(normalizedBasePath.length) || '/';
}

export function appPath(path: string): string {
  return withAppBasePath(path, appBasePath);
}

export function appResourceUrl(url: string): string {
  return url.startsWith('/') ? appPath(url) : url;
}

export function appRelativePath(pathname: string): string {
  return withoutAppBasePath(pathname, appBasePath);
}
