import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../auth/guards/suite-auth.guard';
import { svcAuthorized } from '../svc/svc.service';
import { OpsLinkService, type OpsFixedAsset } from './ops-link.service';

/** Synergy Ops sends its fixed assets here (its OPS_BOOKS_URL), authorized by BOOKS_SVC_TOKEN. */
@ApiExcludeController()
@Public()
@Controller('svc/fixed-assets')
export class OpsLinkController {
  constructor(private readonly ops: OpsLinkService) {}

  @Post()
  @HttpCode(200)
  async fixedAsset(@Headers('authorization') auth: string | undefined, @Body() body: OpsFixedAsset) {
    if (!svcAuthorized(auth)) throw new UnauthorizedException();
    return this.ops.fixedAsset(body);
  }
}
