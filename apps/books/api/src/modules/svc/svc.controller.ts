import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/guards/suite-auth.guard';
import { SvcService, parseSvcJournal, svcAuthorized } from './svc.service';

/**
 * Service-to-service feeds for other suite apps, authorized by BOOKS_SVC_TOKEN rather than a
 * signed-in user. The Portal add-on lists a client's invoices from here (its INVOICE_SVC_URL), and
 * HR posts each paid pay run's journal entry here.
 */
@ApiExcludeController()
@Public()
@Controller('svc')
export class SvcController {
  constructor(private readonly svc: SvcService) {}

  @Get('invoices')
  async invoices(@Headers('authorization') auth: string | undefined, @Query('email') email?: string) {
    if (!svcAuthorized(auth)) throw new UnauthorizedException();
    if (!email || !email.includes('@')) throw new BadRequestException('email is required');
    return this.svc.invoicesFor(email);
  }

  @Post('journals')
  @HttpCode(200)
  async journal(@Headers('authorization') auth: string | undefined, @Body() body: unknown) {
    if (!svcAuthorized(auth)) throw new UnauthorizedException();
    return this.svc.postJournal(parseSvcJournal(body));
  }
}
