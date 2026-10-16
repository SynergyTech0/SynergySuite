import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InventoryService, CreateInventoryItemDto } from './inventory.service';

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('organizations/:organizationId/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post('items')
  @ApiOperation({ summary: 'Create an inventory item' })
  async createItem(
    @Param('organizationId') organizationId: string,
    @Body() dto: CreateInventoryItemDto,
  ) {
    return this.inventoryService.createInventoryItem(organizationId, dto);
  }

  @Get('items/:itemId')
  @ApiOperation({ summary: 'Get an inventory item' })
  async getItem(
    @Param('organizationId') organizationId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.inventoryService.getInventoryItem(organizationId, itemId);
  }

  @Get('items')
  @ApiOperation({ summary: 'List inventory items' })
  async listItems(
    @Param('organizationId') organizationId: string,
    @Query('category') category?: string,
    @Query('lowStock') lowStock?: string,
  ) {
    return this.inventoryService.listInventoryItems(organizationId, {
      category,
      lowStock: lowStock === 'true',
    });
  }

  @Post('items/:itemId/transaction')
  @ApiOperation({ summary: 'Record inventory transaction' })
  async recordTransaction(
    @Param('organizationId') organizationId: string,
    @Param('itemId') itemId: string,
    @Body() body: { transactionType: string; quantity: number; unitCost: number; referenceId?: string; notes?: string },
  ) {
    return this.inventoryService.recordInventoryTransaction(
      organizationId,
      itemId,
      body.transactionType,
      body.quantity,
      body.unitCost,
      body.referenceId,
      body.notes,
    );
  }

  @Get('valuation')
  @ApiOperation({ summary: 'Get inventory valuation' })
  async getValuation(@Param('organizationId') organizationId: string) {
    return this.inventoryService.getInventoryValuation(organizationId);
  }
}
