import { SetMetadata } from '@nestjs/common';

export const PLATFORM_ONLY_KEY = 'platform_only';
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY_KEY, true);
