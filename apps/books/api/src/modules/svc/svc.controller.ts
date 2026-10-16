import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/guards/suite-auth.guard';
import { OpsFixedAsset, OpsStockMove, OpsSvcService } from './ops-svc.service';
import { SvcService, svcAuthorized } from './svc.service';

/**
 * Service-to-service feeds for other suite apps, authorized by BOOKS_SVC_TOKEN rather than a
 * signed-in user. The Portal add-on lists a client's invoices from here (its INVOICE_SVC_URL), and
 * Synergy Ops sends its stock moves and fixed assets here (its OPS_BOOKS_URL).
 */
@ApiExcludeController()
@Public()
@Controller('svc')
export class SvcController {
  constructor(
    private readonly svc: SvcService,
    private readonly ops: OpsSvcService,
  ) {}

  @Get('invoices')
  async invoices(@Headers('authorization') auth: string | undefined, @Query('email') email?: string) {
    if (!svcAuthorized(auth)) throw new UnauthorizedException();
    if (!email || !email.includes('@')) throw new BadRequestException('email is required');
    return this.svc.invoicesFor(email);
  }

  @Get('items')
  async items(@Headers('authorization') auth: string | undefined) {
    if (!svcAuthorized(auth)) throw new UnauthorizedException();
    return this.ops.items();
  }

  @Post('stock-moves')
  @HttpCode(200)
  async stockMove(@Headers('authorization') auth: string | undefined, @Body() body: OpsStockMove) {
    if (!svcAuthorized(auth)) throw new UnauthorizedException();
    return this.ops.stockMove(body);
  }

  @Post('fixed-assets')
  @HttpCode(200)
  async fixedAsset(@Headers('authorization') auth: string | undefined, @Body() body: OpsFixedAsset) {
    if (!svcAuthorized(auth)) throw new UnauthorizedException();
    return this.ops.fixedAsset(body);
  }
}
