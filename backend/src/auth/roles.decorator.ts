import { SetMetadata } from '@nestjs/common';
import { PerfilUsuario } from '../entities/usuario.entity';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: PerfilUsuario[]) =>
  SetMetadata(ROLES_KEY, roles);
