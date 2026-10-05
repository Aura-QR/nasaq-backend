
import { Role } from '../enums/role.enum';

export type AuthJwtPayload = {
    sub: string;
    email: string;
    role: Role | string;
    schoolId: string | null;
    permissions?: string[];
    permissionsVersion?: number;
    /**
     * The person's display name. Services write it as «reviewed by» on
     * leave, excuses, late reasons and preparations; without it every one of
     * those read `user.name` as undefined and stored an empty name.
     */
    name?: string;
}