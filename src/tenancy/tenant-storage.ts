import { AsyncLocalStorage } from 'async_hooks';

export interface TenantStore {
  schoolId: string | null;
  isAdminContext: boolean;
}

export const tenantLocalStorage = new AsyncLocalStorage<TenantStore>();
