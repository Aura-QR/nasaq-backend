import { Request } from 'express';

export function getBaseUrl(req: Request): string {
  const protocol = req.protocol;
  const host = req.get('host');
  return `${protocol}://${host}`;
}

export function getFullUrl(req: Request, path: string): string {
  const baseUrl = getBaseUrl(req);
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
}
