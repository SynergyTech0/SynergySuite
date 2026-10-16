import { Controller, Get, Req } from '@nestjs/common';

@Controller('auth')
export class AuthController {
  /** The signed-in user and the organization they belong to. */
  @Get('me')
  me(@Req() req: { user: { id: string; email: string; firstName: string; lastName: string; role: string; organizationId: string } }) {
    const { id, email, firstName, lastName, role, organizationId } = req.user;
    // suiteDomain lets the web app point the suite header's app launcher at the other apps.
    return { user: { id, email, firstName, lastName, role, organizationId }, suiteDomain: process.env.SUITE_DOMAIN || null };
  }
}
