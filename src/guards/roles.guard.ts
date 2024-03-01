import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export interface IRolesGuardConfig {
  getUserRoles: (context: ExecutionContext) => Promise<string[]> | string[];
}

@Injectable()
export class RolesGuard implements CanActivate {
  static RolesGuardConfigKey = 'NestKit:RolesGuardConfig';

  constructor(
    private readonly reflector: Reflector,

    @Inject(RolesGuard.RolesGuardConfigKey)
    private readonly config: IRolesGuardConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get roles
    const ctrlRoles = this.reflector.get<string[]>('roles', context.getClass()) || [];
    const actionRoles = this.reflector.get<string[]>('roles', context.getHandler()) || [];

    // No role check, return true
    if (ctrlRoles.length === 0 && actionRoles.length === 0) {
      return true;
    }
    // Get user roles
    const userRoles: string[] = await this.config.getUserRoles(context);

    // no roles
    if (!userRoles || userRoles.length === 0) {
      throw new UnauthorizedException();
    }

    const canVisitCtrl = !ctrlRoles || userRoles.some((x: string) => (ctrlRoles || []).includes(x));
    if (!canVisitCtrl) {
      throw new ForbiddenException();
    }

    const canVisitHandler = !actionRoles || userRoles.some((x: string) => actionRoles.includes(x));
    if (!canVisitHandler) {
      throw new ForbiddenException();
    }

    return true;
  }
}
