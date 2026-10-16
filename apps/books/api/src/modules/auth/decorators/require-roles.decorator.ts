import { SetMetadata } from '@nestjs/common';
import { UserRole, ROLES_KEY } from '../guards/roles.guard';

export const RequireRoles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
