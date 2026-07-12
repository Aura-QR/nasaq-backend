import { SetMetadata } from '@nestjs/common';

export interface RequiredAbility {
  action: string;
  subject: string;
}

export const CHECK_ABILITY = 'check_ability';

export const CheckAbilities = (...abilities: RequiredAbility[]) =>
  SetMetadata(CHECK_ABILITY, abilities);