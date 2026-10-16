import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from '@prisma/client/runtime/library';

export class CreatePurchaseOrderDto {
  vendorId: string;
  poDate: Date;
  deliveryDate?: Date;
  lineItems: POLineItemDto[];
  currency?: string;
  notes?: string;
  terms?: string;
  shippingAddress?: any;
}

export class POLineItemDto {
  description: string;
  quantity: number;
  unitPrice: number;
  taxable?: boolean;
}

@Injectable()
export class PurchaseOrderService {
  private readonly logger = new Logger(PurchaseOrderService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createPurchaseOrder(organizationId: string, dto: CreatePurchaseOrderDto, userId: string) {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: dto.vendorId },
    });

    if (!vendor || vendor.organizationId !== organizationId) {
      throw new NotFoundException('Vendor not found');
    }

    const poCount = await this.prisma.purchaseOrder.count({ where: { organizationId } });
    const poNumber = `PO-${new Date().getFullYear()}-${String(poCount + 1).padStart(5, '0')}`;

    let subtotal = new Decimal(0);
    const lineItems = dto.lineItems.map((item, index) => {
      const amount = new Decimal(item.quantity).times(new Decimal(item.unitPrice));
      subtotal = subtotal.plus(amount);
      return {
        ...item,
        amount: amount.toNumber(),
        lineNumber: index + 1,
        receivedQty: 0,
      };
    });

    const tax = subtotal.times(new Decimal(0.1));
    const total = subtotal.plus(tax);

    const po = await this.prisma.purchaseOrder.create({
      data: {
        id: uuidv4(),
        organizationId,
        vendorId: dto.vendorId,
        poNumber,
        poDate: new Date(dto.poDate),
        deliveryDate: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
        subtotal: subtotal.toNumber(),
        tax: tax.toNumber(),
        total: total.toNumber(),
        currency: dto.currency || 'USD',
        notes: dto.notes,
        terms: dto.terms,
        shippingAddress: dto.shippingAddress,
        createdBy: userId,
        lineItems: {
          createMany: {
            data: lineItems,
          },
        },
      },
      include: { lineItems: true, vendor: true },
    });

    this.logger.log(`Purchase Order ${poNumber} created`);
    return po;
  }

  async getPurchaseOrder(organizationId: string, poId: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lineItems: true, vendor: true, receipts: true, documents: true },
    });

    if (!po || po.organizationId !== organizationId) {
      throw new NotFoundException('Purchase order not found');
    }

    return po;
  }

  async listPurchaseOrders(organizationId: string, filters?: { vendorId?: string; status?: string }) {
    return this.prisma.purchaseOrder.findMany({
      where: {
        organizationId,
        ...(filters?.vendorId && { vendorId: filters.vendorId }),
        ...(filters?.status && { status: filters.status as any }),
      },
      include: { lineItems: true, vendor: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async receivePO(organizationId: string, poId: string, receipts: { lineItemId: string; quantity: number }[], userId: string) {
    const po = await this.getPurchaseOrder(organizationId, poId);

    const grCount = await this.prisma.goodsReceipt.count({ where: { organizationId } });
    const receiptNumber = `GR-${new Date().getFullYear()}-${String(grCount + 1).padStart(5, '0')}`;

    const receipt = await this.prisma.goodsReceipt.create({
      data: {
        id: uuidv4(),
        organizationId,
        poId,
        receiptNumber,
        receiptDate: new Date(),
        lineItems: {
          createMany: {
            data: receipts.map((r, i) => ({
              lineNumber: i + 1,
              quantity: r.quantity,
              poLineItemId: r.lineItemId,
            })),
          },
        },
      },
      include: { lineItems: true },
    });

    // Update PO line items with received qty
    for (const receipt of receipts) {
      const poLineItem = po.lineItems.find((li) => li.id === receipt.lineItemId);
      if (poLineItem) {
        await this.prisma.pOLineItem.update({
          where: { id: receipt.lineItemId },
          data: {
            receivedQty: new Decimal(poLineItem.receivedQty).plus(new Decimal(receipt.quantity)).toNumber(),
          },
        });
      }
    }

    // Update PO status
    // Cumulative: quantities received on earlier receipts plus this receipt
    const previouslyReceived = po.lineItems.reduce((sum, li) => sum + Number(li.receivedQty ?? 0), 0);
    const totalReceived = previouslyReceived + receipts.reduce((sum, r) => sum + r.quantity, 0);
    const totalOrdered = po.lineItems.reduce((sum, li) => sum + Number(li.quantity), 0);

    const newStatus = totalReceived >= totalOrdered ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    await this.prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: newStatus as any },
    });

    this.logger.log(`Goods receipt ${receiptNumber} created for PO ${po.poNumber}`);
    return receipt;
  }

  async updatePOStatus(organizationId: string, poId: string, status: string) {
    const po = await this.getPurchaseOrder(organizationId, poId);

    return this.prisma.purchaseOrder.update({
      where: { id: poId },
      data: { status: status as any },
      include: { lineItems: true, vendor: true },
    });
  }

  async deletePurchaseOrder(organizationId: string, poId: string) {
    const po = await this.getPurchaseOrder(organizationId, poId);

    if (po.status !== 'DRAFT') {
      throw new BadRequestException('Can only delete draft purchase orders');
    }

    await this.prisma.purchaseOrder.delete({
      where: { id: poId },
    });

    this.logger.log(`Purchase order ${po.poNumber} deleted`);
  }
}
