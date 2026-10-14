import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { CaslAbilityFactory } from '../casl/casl-ability.factory';

/**
 * For the upload route: a file goes onto a slide being created or one being
 * edited, so either permission is enough. @CheckAbilities can only demand all
 * of what it lists.
 *
 * A guard rather than a check in the handler because guards run before the
 * upload interceptor — refused here, the file is never written to disk.
 * It has no dependencies, so declaring it on a route cannot break the module's
 * injector the way a local AbilitiesGuard once took the app down on boot.
 */
@Injectable()
export class AnnouncementEditorGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest().user;
    const ability = await new CaslAbilityFactory().defineAbilitiesFor(user);
    if (ability.can('create', 'Announcement') || ability.can('update', 'Announcement')) return true;
    throw new ForbiddenException('ليس لديك صلاحية للقيام بهذا الإجراء');
  }
}
