import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { TaxClassificationService } from './tax-classification.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AIClassifier } from './classifiers/ai.classifier';
import { TaxRuleEngine } from './engines/tax-rule.engine';
import { CitationGenerator } from './generators/citation.generator';

describe('TaxClassificationService', () => {
  let service: TaxClassificationService;

  const mockPrismaService = {
    journalLineTaxClassification: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    classificationFeedback: {
      groupBy: jest.fn(),
    },
  };

  const inOrg = { journalLine: { journal: { organizationId: 'org-1' } } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaxClassificationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AIClassifier, useValue: {} },
        { provide: TaxRuleEngine, useValue: {} },
        { provide: CitationGenerator, useValue: {} },
        { provide: getQueueToken('tax-classification'), useValue: { add: jest.fn() } },
      ],
    }).compile();

    service = module.get<TaxClassificationService>(TaxClassificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getClassificationHistory', () => {
    it("returns only the organization's classifications", async () => {
      mockPrismaService.journalLineTaxClassification.findMany.mockResolvedValue([]);

      await service.getClassificationHistory('org-1', { category: 'BUSINESS_EXPENSE' as any });

      expect(mockPrismaService.journalLineTaxClassification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { ...inOrg, category: 'BUSINESS_EXPENSE' } }),
      );
    });
  });

  describe('getClassificationStats', () => {
    it('counts categories and feedback within the organization only', async () => {
      mockPrismaService.journalLineTaxClassification.groupBy.mockResolvedValue([
        { category: 'BUSINESS_EXPENSE', _count: { id: 3 }, _avg: { confidence: 0.9 } },
      ]);
      mockPrismaService.journalLineTaxClassification.findMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
      mockPrismaService.classificationFeedback.groupBy.mockResolvedValue([
        { isCorrect: true, _count: { id: 3 } },
        { isCorrect: false, _count: { id: 1 } },
      ]);

      const stats = await service.getClassificationStats('org-1');

      expect(mockPrismaService.journalLineTaxClassification.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: inOrg }),
      );
      expect(mockPrismaService.classificationFeedback.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { journalLineTaxClassificationId: { in: ['c1', 'c2'] } } }),
      );
      expect(stats).toEqual({
        byCategory: [{ category: 'BUSINESS_EXPENSE', count: 3, avgConfidence: 0.9 }],
        accuracy: 0.75,
      });
    });

    it('reports no accuracy, not 100%, when nothing has been judged', async () => {
      mockPrismaService.journalLineTaxClassification.groupBy.mockResolvedValue([]);
      mockPrismaService.journalLineTaxClassification.findMany.mockResolvedValue([]);

      const stats = await service.getClassificationStats('org-1');

      expect(mockPrismaService.classificationFeedback.groupBy).not.toHaveBeenCalled();
      expect(stats).toEqual({ byCategory: [], accuracy: null });
    });
  });
});
