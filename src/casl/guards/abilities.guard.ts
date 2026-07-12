import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CaslAbilityFactory, Actions, Subjects } from '../casl-ability.factory';
import { CHECK_ABILITY, RequiredAbility } from '../decorators/check-abilities.decorator';

@Injectable()
export class AbilitiesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private caslAbilityFactory: CaslAbilityFactory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredAbilities = this.reflector.get<RequiredAbility[]>(
      CHECK_ABILITY,
      context.getHandler(),
    );

    if (!requiredAbilities) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('المستخدم غير مصرح له');
    }

    const ability = await this.caslAbilityFactory.defineAbilitiesFor(user);

    const hasPermission = requiredAbilities.every((permission) =>
      ability.can(permission.action as Actions, permission.subject as Subjects),
    );

    if (!hasPermission) {
      throw new ForbiddenException('ليس لديك صلاحية للقيام بهذا الإجراء');
    }

    return true;
  }
}
