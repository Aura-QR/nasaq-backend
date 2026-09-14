import { SetMetadata } from '@nestjs/common';

export interface RequiredAbility {
  action: string;
  subject: string;
  /**
   * Enforce this requirement only for callers with one of these roles; everyone
   * else the route admits passes it untouched.
   *
   * For routes teachers and students also call. Their stored permissions were
   * never written for these routes — `read Teacher` is the teacher DIRECTORY, and
   * the TEACHER role has `teachers: NONE` — so a plain check there locks them out
   * of screens they use today (see the note on GET /teachers/me). Scoping the
   * check to MANAGER applies the permissions screen to the one role it governs.
   */
  roles?: string[];
}

export const CHECK_ABILITY = 'check_ability';

export const CheckAbilities = (...abilities: RequiredAbility[]) =>
  SetMetadata(CHECK_ABILITY, abilities);
