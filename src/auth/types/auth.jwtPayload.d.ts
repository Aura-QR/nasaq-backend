
import { Role } from '../enums/role.enum';

export type AuthJwtPayload = {
    sub: string;
    email: string;
    role: Role;
}