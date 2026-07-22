import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { PLATFORM_ONLY_KEY } from '../decorators/platform-only.decorator';
import { IS_PUBLIC_KEY } from 'src/auth/decorators/public.decorator';

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectConnection() private connection: Connection,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const isPlatformOnly = this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (isPlatformOnly) {
      if (user.schoolId !== null && user.schoolId !== undefined) {
        throw new ForbiddenException('School context cannot access platform routes');
      }
      if (user.role !== 'SUPER_ADMIN') {
        throw new ForbiddenException('Super admin permissions required');
      }
      return true;
    } else {
      if (!user.schoolId) {
        throw new ForbiddenException('School context required');
      }
      if (user.role === 'SUPER_ADMIN') {
        throw new ForbiddenException('Platform admins cannot perform school-scoped actions directly');
      }

      // Check if School model exists in mongoose connection before querying
      try {
        const SchoolModel = this.connection.model('School');
        const school = (await SchoolModel.findById(user.schoolId)
          .setOptions({ skipTenantScope: true })
          .lean()) as any;

        if (!school) {
          throw new ForbiddenException('School not found');
        }
        if (!school.isActive) {
          throw new ForbiddenException('School is suspended');
        }
      } catch (err: any) {
        // If Model hasn't been registered yet (e.g., during initialization/boot), skip or handle
        if (err?.name === 'MissingSchemaError') {
          // When school model is not yet compiled, allow passing to prevent bootstrap failures
          return true;
        }
        throw err;
      }

      return true;
    }
  }
}
