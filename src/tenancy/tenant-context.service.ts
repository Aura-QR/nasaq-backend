import { Injectable } from '@nestjs/common';
import { tenantLocalStorage } from './tenant-storage';

@Injectable()
export class TenantContextService {
  getSchoolId(): string | null {
    const store = tenantLocalStorage.getStore();
    return store ? store.schoolId : null;
  }

  isAdminContext(): boolean {
    const store = tenantLocalStorage.getStore();
    return store ? store.isAdminContext : false;
  }

  runWithTenant<T>(schoolId: string | null, isAdminContext: boolean, callback: () => T): T {
    return tenantLocalStorage.run({ schoolId, isAdminContext }, callback);
  }
}
