import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ClassLocationService {
  constructor(private readonly prisma: PrismaService) {}

  // Classes
  async createClass(organizationId: string, data: {
    name: string;
    description?: string;
    parentClassId?: string;
    isActive?: boolean;
  }) {
    const existing = await this.prisma.class.findFirst({
      where: { organizationId, name: data.name },
    });

    if (existing) throw new ConflictException('Class with this name already exists');

    if (data.parentClassId) {
      const parent = await this.prisma.class.findFirst({
        where: { id: data.parentClassId, organizationId },
      });
      if (!parent) throw new NotFoundException('Parent class not found');
    }

    return this.prisma.class.create({
      data: {
        organizationId,
        name: data.name,
        description: data.description,
        parentId: data.parentClassId,
        isActive: data.isActive ?? true,
      },
    });
  }

  async getClasses(organizationId: string, options?: { includeInactive?: boolean; parentClassId?: string | null }) {
    return this.prisma.class.findMany({
      where: {
        organizationId,
        ...(options?.includeInactive === false && { isActive: true }),
        ...(options?.parentClassId !== undefined && { parentId: options.parentClassId }),
      },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { children: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getClass(organizationId: string, classId: string) {
    const classRecord = await this.prisma.class.findFirst({
      where: { id: classId, organizationId },
      include: {
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true, isActive: true } },
      },
    });

    if (!classRecord) throw new NotFoundException('Class not found');
    const { children, ...rest } = classRecord;
    return { ...rest, subclasses: children };
  }

  async updateClass(organizationId: string, classId: string, data: {
    name?: string;
    description?: string;
    parentClassId?: string;
    isActive?: boolean;
  }) {
    const existing = await this.prisma.class.findFirst({
      where: { id: classId, organizationId },
    });

    if (!existing) throw new NotFoundException('Class not found');

    if (data.name && data.name !== existing.name) {
      const duplicate = await this.prisma.class.findFirst({
        where: { organizationId, name: data.name, id: { not: classId } },
      });
      if (duplicate) throw new ConflictException('Class with this name already exists');
    }

    if (data.parentClassId) {
      if (data.parentClassId === classId) throw new BadRequestException('Cannot set self as parent');
      const parent = await this.prisma.class.findFirst({
        where: { id: data.parentClassId, organizationId },
      });
      if (!parent) throw new NotFoundException('Parent class not found');
    }

    const { parentClassId, ...rest } = data;
    return this.prisma.class.update({
      where: { id: classId },
      data: {
        ...rest,
        ...(parentClassId !== undefined && { parentId: parentClassId }),
      },
    });
  }

  async deleteClass(organizationId: string, classId: string) {
    const existing = await this.prisma.class.findFirst({
      where: { id: classId, organizationId },
      include: { _count: { select: { children: true } } },
    });

    if (!existing) throw new NotFoundException('Class not found');
    if (existing._count.children > 0) {
      throw new BadRequestException('Cannot delete class with subclasses');
    }

    // Check if used in transactions - in production would check all related tables
    // For now, just soft delete by marking inactive
    return this.prisma.class.update({
      where: { id: classId },
      data: { isActive: false },
    });
  }

  // Locations
  async createLocation(organizationId: string, data: {
    name: string;
    description?: string;
    address?: any;
    parentLocationId?: string;
    isActive?: boolean;
  }) {
    const existing = await this.prisma.location.findFirst({
      where: { organizationId, name: data.name },
    });

    if (existing) throw new ConflictException('Location with this name already exists');

    if (data.parentLocationId) {
      const parent = await this.prisma.location.findFirst({
        where: { id: data.parentLocationId, organizationId },
      });
      if (!parent) throw new NotFoundException('Parent location not found');
    }

    return this.prisma.location.create({
      data: {
        organizationId,
        name: data.name,
        description: data.description,
        address: data.address,
        parentId: data.parentLocationId,
        isActive: data.isActive ?? true,
      },
    });
  }

  async getLocations(organizationId: string, options?: { includeInactive?: boolean; parentLocationId?: string | null }) {
    return this.prisma.location.findMany({
      where: {
        organizationId,
        ...(options?.includeInactive === false && { isActive: true }),
        ...(options?.parentLocationId !== undefined && { parentId: options.parentLocationId }),
      },
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { children: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getLocation(organizationId: string, locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, organizationId },
      include: {
        parent: { select: { id: true, name: true } },
        children: { select: { id: true, name: true, isActive: true } },
      },
    });

    if (!location) throw new NotFoundException('Location not found');
    const { children, ...rest } = location;
    return { ...rest, sublocations: children };
  }

  async updateLocation(organizationId: string, locationId: string, data: {
    name?: string;
    description?: string;
    address?: any;
    parentLocationId?: string;
    isActive?: boolean;
  }) {
    const existing = await this.prisma.location.findFirst({
      where: { id: locationId, organizationId },
    });

    if (!existing) throw new NotFoundException('Location not found');

    if (data.name && data.name !== existing.name) {
      const duplicate = await this.prisma.location.findFirst({
        where: { organizationId, name: data.name, id: { not: locationId } },
      });
      if (duplicate) throw new ConflictException('Location with this name already exists');
    }

    if (data.parentLocationId) {
      if (data.parentLocationId === locationId) throw new BadRequestException('Cannot set self as parent');
      const parent = await this.prisma.location.findFirst({
        where: { id: data.parentLocationId, organizationId },
      });
      if (!parent) throw new NotFoundException('Parent location not found');
    }

    const { parentLocationId, ...rest } = data;
    return this.prisma.location.update({
      where: { id: locationId },
      data: {
        ...rest,
        ...(parentLocationId !== undefined && { parentId: parentLocationId }),
      },
    });
  }

  async deleteLocation(organizationId: string, locationId: string) {
    const existing = await this.prisma.location.findFirst({
      where: { id: locationId, organizationId },
      include: { _count: { select: { children: true } } },
    });

    if (!existing) throw new NotFoundException('Location not found');
    if (existing._count.children > 0) {
      throw new BadRequestException('Cannot delete location with sublocations');
    }

    return this.prisma.location.update({
      where: { id: locationId },
      data: { isActive: false },
    });
  }

  // Reporting
  async getClassProfitLoss(organizationId: string, startDate: Date, endDate: Date) {
    // This would query journal entries, invoices, bills, etc. grouped by class
    // Simplified implementation - would need complex aggregation
    const classes = await this.getClasses(organizationId, { includeInactive: false });
    
    return {
      period: { startDate, endDate },
      classes: classes.map(cls => ({
        classId: cls.id,
        className: cls.name,
        revenue: 0, // Would calculate from actual transactions
        expenses: 0,
        netIncome: 0,
      })),
    };
  }

  async getLocationProfitLoss(organizationId: string, startDate: Date, endDate: Date) {
    const locations = await this.getLocations(organizationId, { includeInactive: false });
    
    return {
      period: { startDate, endDate },
      locations: locations.map(loc => ({
        locationId: loc.id,
        locationName: loc.name,
        revenue: 0, // Would calculate from actual transactions
        expenses: 0,
        netIncome: 0,
      })),
    };
  }
}
