import { Controller, Get, Post, Delete, Param, Query, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DocumentService } from './document.service';

@ApiTags('documents')
@ApiBearerAuth()
@Controller('organizations/:organizationId/documents')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post()
  @ApiOperation({ summary: 'Upload a document' })
  async uploadDocument(
    @Param('organizationId') organizationId: string,
    @Body()
    body: {
      documentType: string;
      fileName: string;
      fileSize: number;
      mimeType: string;
      storagePath: string;
      relatedEntityId?: string;
      relatedEntityType?: string;
      description?: string;
    },
  ) {
    return this.documentService.uploadDocument(
      organizationId,
      body.documentType,
      body.fileName,
      body.fileSize,
      body.mimeType,
      body.storagePath,
      'user-id',
      body.relatedEntityId,
      body.relatedEntityType,
      body.description,
    );
  }

  @Get(':documentId')
  @ApiOperation({ summary: 'Get a document' })
  async getDocument(
    @Param('organizationId') organizationId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentService.getDocument(organizationId, documentId);
  }

  @Get()
  @ApiOperation({ summary: 'List documents' })
  async listDocuments(
    @Param('organizationId') organizationId: string,
    @Query('documentType') documentType?: string,
    @Query('relatedEntityId') relatedEntityId?: string,
  ) {
    return this.documentService.listDocuments(organizationId, { documentType, relatedEntityId });
  }

  @Get('search/:term')
  @ApiOperation({ summary: 'Search documents' })
  async searchDocuments(
    @Param('organizationId') organizationId: string,
    @Param('term') term: string,
  ) {
    return this.documentService.searchDocuments(organizationId, term);
  }

  @Delete(':documentId')
  @ApiOperation({ summary: 'Delete a document' })
  async deleteDocument(
    @Param('organizationId') organizationId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentService.deleteDocument(organizationId, documentId);
  }

  @Post(':documentId/archive')
  @ApiOperation({ summary: 'Archive a document' })
  async archiveDocument(
    @Param('organizationId') organizationId: string,
    @Param('documentId') documentId: string,
  ) {
    return this.documentService.archiveDocument(organizationId, documentId);
  }
}
