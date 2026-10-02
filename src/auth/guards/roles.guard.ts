import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';

/**
 * Controllers a STAFF account may use without being named in @Roles: its own
 * account and its own notices. Both scope every query to the caller.
 */
const STAFF_SHARED_CONTROLLERS = new Set(['AuthController', 'NotificationsController']);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(), // from the api itself 
      context.getClass(), // from the class 
    ]);

    const user = context.switchToHttp().getRequest().user;

    if (!requiredRoles) {
      // A route with no @Roles is open to every signed-in role — that is how
      // read routes across the API were written, and teachers and students
      // rely on it. Service staff are the exception: allow-listed, not
      // deny-listed. A guard signing in found GET /students open, with every
      // family's phone number and address on it; rather than find every such
      // route, STAFF reaches only what names it, plus its own account and
      // notices.
      if (user?.role === Role.STAFF) {
        return STAFF_SHARED_CONTROLLERS.has(context.getClass().name);
      }
      return true;
    }

    if (!user) {
      return false;
    }

    return requiredRoles.some((role) => user.role === role);
  }
}
