import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or entire controller) as public, bypassing the global
 * JwtAuthGuard and TenantGuard. Use ONLY for genuinely public endpoints
 * (login, registration, password-setup flows, health checks).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
