import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(
    context: ExecutionContext
  ): boolean | Promise<boolean> | Observable<boolean> {
    // Get roles
    const ctrlRoles = this.reflector.get<string[]>('roles', context.getClass());
    const handlerRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler()
    );

    if (!ctrlRoles && !handlerRoles) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    // Logged user roles
    const userRoles: string[] = request?.session?.user?.roles || [];

    // no roles
    if (!userRoles || userRoles.length === 0) {
      throw new UnauthorizedException();
    }

    const canVisitCtrl =
      !userRoles ||
      userRoles.some((x: string) => (ctrlRoles || []).includes(x));
    if (!canVisitCtrl) {
      throw new ForbiddenException();
    }

    const canVisitHandler =
      !handlerRoles || userRoles.some((x: string) => handlerRoles.includes(x));
    if (!canVisitHandler) {
      throw new ForbiddenException();
    }

    return true;
  }
}
