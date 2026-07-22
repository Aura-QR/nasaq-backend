/**
 * DEPRECATED — DO NOT USE.
 *
 * This middleware used to decode the JWT payload directly from the
 * Authorization header WITHOUT verifying its cryptographic signature
 * (plain base64 decode). That made it possible for any caller to forge
 * an arbitrary `schoolId`/`role` and have it trusted as the active tenant
 * context — a complete authentication/tenant-isolation bypass.
 *
 * It has been replaced by `TenantContextInterceptor`, which populates the
 * tenant context strictly from `request.user`, which is only ever set by
 * `JwtAuthGuard` AFTER Passport has cryptographically verified the JWT
 * signature. Interceptors run after guards in the Nest request lifecycle,
 * so this is the correct place to establish trusted tenant context.
 *
 * This file is intentionally left as a non-functional stub (rather than
 * deleted) so any stale imports fail loudly at compile time instead of
 * silently reintroducing the vulnerability.
 */
export class TenantMiddleware {
  use(..._args: any[]): void {
    throw new Error(
      'TenantMiddleware is deprecated and insecure. Use TenantContextInterceptor instead.',
    );
  }
}
