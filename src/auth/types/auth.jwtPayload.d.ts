
import { Role } from '../enums/role.enum';

export type AuthJwtPayload = {
    sub: string;
    email: string;
    role: Role | string;
    schoolId: string | null;
    permissions?: string[];
}