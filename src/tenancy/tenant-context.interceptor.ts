import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tenantLocalStorage } from './tenant-storage';

/**
 * Populates the AsyncLocalStorage-based tenant context for every request,
 * strictly from `request.user` — which is only ever set by JwtAuthGuard
 * AFTER the JWT signature has been cryptographically verified by Passport.
 *
 * This interceptor runs AFTER all guards in the Nest request lifecycle
 * (Guards -> Interceptors -> Pipes -> Controller), so `request.user` is
 * guaranteed to be the verified payload (or undefined for @Public() routes
 * where JwtAuthGuard was skipped).
 *
 * IMPORTANT: This must be the ONLY place that populates tenantLocalStorage
 * from request data. Never decode/trust a raw Authorization header here or
 * anywhere else — that was the previous (insecure) approach and allowed
 * forged/unsigned tokens to set an arbitrary schoolId.
 *
 * ALS PROPAGATION NOTE:
 * tenantLocalStorage.run() must wrap the `new Observable(...)` construction,
 * NOT be placed inside it. Constructing a new Observable creates a synchronous
 * closure that does NOT inherit the caller's async context. If run() is called
 * inside the Observable factory, the async context it establishes is discarded
 * before any `await` in the handler runs — causing every tenant-scoped query
 * to receive { schoolId: null } from the plugin's fallback branch.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    const store = {
      schoolId: user?.schoolId ? String(user.schoolId) : null,
      isAdminContext: user?.role === 'SUPER_ADMIN',
    };

    // Wrap the Observable construction inside run() so the async context
    // is active when next.handle() subscribes and all downstream awaits execute.
    return new Observable((subscriber) => {
      tenantLocalStorage.run(store, () => {
        next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
      });
    });
  }
}
