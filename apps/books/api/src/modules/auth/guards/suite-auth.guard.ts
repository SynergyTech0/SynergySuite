import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { identify } from '@synergy/identity';
import { AuthService } from '../auth.service';

export const IS_PUBLIC_KEY = 'isPublic';
/** Skips sign-in for a route (health checks, payment webhooks, the public customer portal). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Every request comes through the suite gateway, which signs the user in with SynergyAuth
 * and passes their identity in headers (see @synergy/identity). This guard turns that
 * identity into a Books user and refuses access to any other organization's data.
 * It runs globally; controllers that still name it in @UseGuards are unaffected.
 */
@Injectable()
export class SuiteAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const who = identify(req.headers);
    if (!who) throw new UnauthorizedException('Sign in through the Synergy suite.');

    const user = await this.auth.userFor(who);
    if (!user.isActive) throw new ForbiddenException('Your Books access is turned off.');
    req.user = user;

    const orgId = req.params?.organizationId ?? req.params?.orgId;
    if (orgId && orgId !== user.organizationId) {
      throw new ForbiddenException('You do not have access to that organization.');
    }
    return true;
  }
}
