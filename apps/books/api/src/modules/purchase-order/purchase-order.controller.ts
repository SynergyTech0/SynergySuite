import { Controller, Get, Post, Body, Param, Put, Delete, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PurchaseOrderService, CreatePurchaseOrderDto } from './purchase-order.service';

@ApiTags('purchase-orders')
@ApiBearerAuth()
@Controller('organizations/:organizationId/purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly poService: PurchaseOrderService) {}

  @Post()
  @ApiOperation({ summary: 'Create a purchase order' })
  async createPO(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.poService.createPurchaseOrder(organizationId, dto, 'user-id');
  }

  @Get(':poId')
  @ApiOperation({ summary: 'Get a purchase order' })
  async getPO(
    @Param('organizationId') organizationId: string,
    @Param('poId') poId: string,
  ) {
    return this.poService.getPurchaseOrder(organizationId, poId);
  }

  @Get()
  @ApiOperation({ summary: 'List purchase orders' })
  async listPOs(
    @Param('organizationId') organizationId: string,
    @Query('vendorId') vendorId?: string,
    @Query('status') status?: string,
  ) {
    return this.poService.listPurchaseOrders(organizationId, { vendorId, status });
  }

  @Post(':poId/receive')
  @ApiOperation({ summary: 'Receive goods for PO' })
  async receivePO(
    @Param('organizationId') organizationId: string,
    @Param('poId') poId: string,
    @Body() body: { receipts: { lineItemId: string; quantity: number }[] },
  ) {
    return this.poService.receivePO(organizationId, poId, body.receipts, 'user-id');
  }

  @Put(':poId/status')
  @ApiOperation({ summary: 'Update PO status' })
  async updateStatus(
    @Param('organizationId') organizationId: string,
    @Param('poId') poId: string,
    @Body('status') status: string,
  ) {
    return this.poService.updatePOStatus(organizationId, poId, status);
  }

  @Delete(':poId')
  @ApiOperation({ summary: 'Delete a purchase order' })
  async deletePO(
    @Param('organizationId') organizationId: string,
    @Param('poId') poId: string,
  ) {
    return this.poService.deletePurchaseOrder(organizationId, poId);
  }
}
