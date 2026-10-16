import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async uploadDocument(
    organizationId: string,
    documentType: string,
    fileName: string,
    fileSize: number,
    mimeType: string,
    storagePath: string,
    userId: string,
    relatedEntityId?: string,
    relatedEntityType?: string,
    description?: string,
  ) {
    const document = await this.prisma.document.create({
      data: {
        id: uuidv4(),
        organizationId,
        documentType: documentType as any,
        fileName,
        fileSize,
        mimeType,
        storagePath,
        uploadedBy: userId,
        relatedEntityId,
        relatedEntityType,
        description,
        metadata: {
          uploadedAt: new Date().toISOString(),
          uploadedBy: userId,
        },
      },
    });

    this.logger.log(`Document ${fileName} uploaded`);
    return document;
  }

  async getDocument(organizationId: string, documentId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!document || document.organizationId !== organizationId) {
      throw new NotFoundException('Document not found');
    }

    return document;
  }

  async listDocuments(organizationId: string, filters?: { documentType?: string; relatedEntityId?: string }) {
    return this.prisma.document.findMany({
      where: {
        organizationId,
        ...(filters?.documentType && { documentType: filters.documentType as any }),
        ...(filters?.relatedEntityId && { relatedEntityId: filters.relatedEntityId }),
      },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async deleteDocument(organizationId: string, documentId: string) {
    const document = await this.getDocument(organizationId, documentId);

    await this.prisma.document.delete({
      where: { id: documentId },
    });

    this.logger.log(`Document ${document.fileName} deleted`);
  }

  async archiveDocument(organizationId: string, documentId: string) {
    const document = await this.getDocument(organizationId, documentId);

    return this.prisma.document.update({
      where: { id: documentId },
      data: { isArchived: true },
    });
  }

  async searchDocuments(organizationId: string, searchTerm: string) {
    // Simple search by filename or description
    return this.prisma.document.findMany({
      where: {
        organizationId,
        OR: [
          { fileName: { contains: searchTerm, mode: 'insensitive' } },
          { description: { contains: searchTerm, mode: 'insensitive' } },
        ],
      },
      orderBy: { uploadedAt: 'desc' },
    });
  }
}
