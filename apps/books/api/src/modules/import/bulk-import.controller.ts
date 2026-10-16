import { Controller, Get, Post, Body, Param, Put, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BulkImportService } from './bulk-import.service';

@ApiTags('bulk-import')
@ApiBearerAuth()
@Controller('organizations/:organizationId/bulk-import')
export class BulkImportController {
  constructor(private readonly bulkImportService: BulkImportService) {}

  @Post('create')
  @ApiOperation({ summary: 'Create a bulk import' })
  async createImport(
    @Param('organizationId') organizationId: string,
    @Body() body: { importType: string; fileName: string; rowCount: number; mappingConfig?: any },
  ) {
    return this.bulkImportService.createImport(organizationId, body.importType, body.fileName, body.rowCount, 'user-id', body.mappingConfig);
  }

  @Post(':importId/row')
  @ApiOperation({ summary: 'Add import row' })
  async addRow(
    @Param('organizationId') organizationId: string,
    @Param('importId') importId: string,
    @Body() body: { rowNumber: number; data: any },
  ) {
    return this.bulkImportService.addImportRow(importId, body.rowNumber, body.data);
  }

  @Put(':importId/row/:rowNumber/process')
  @ApiOperation({ summary: 'Process import row' })
  async processRow(
    @Param('importId') importId: string,
    @Param('rowNumber') rowNumber: string,
  ) {
    return this.bulkImportService.processImportRow(importId, parseInt(rowNumber));
  }

  @Get(':importId')
  @ApiOperation({ summary: 'Get import details' })
  async getImport(
    @Param('organizationId') organizationId: string,
    @Param('importId') importId: string,
  ) {
    return this.bulkImportService.getImport(organizationId, importId);
  }

  @Get()
  @ApiOperation({ summary: 'List imports' })
  async listImports(
    @Param('organizationId') organizationId: string,
    @Query('status') status?: string,
    @Query('importType') importType?: string,
  ) {
    return this.bulkImportService.listImports(organizationId, { status, importType });
  }

  @Get(':importId/errors')
  @ApiOperation({ summary: 'Get import errors' })
  async getErrors(@Param('importId') importId: string) {
    return this.bulkImportService.getImportErrors(importId);
  }

  @Put(':importId/retry')
  @ApiOperation({ summary: 'Retry import' })
  async retryImport(
    @Param('organizationId') organizationId: string,
    @Param('importId') importId: string,
  ) {
    return this.bulkImportService.retryImport(organizationId, importId);
  }
}
