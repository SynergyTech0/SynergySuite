import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { TaxClassificationService } from './tax-classification.service';
import { TaxClassificationController } from './tax-classification.controller';
import { TaxClassificationProcessor } from './tax-classification.processor';
import { TaxRuleEngine } from './engines/tax-rule.engine';
import { AIClassifier } from './classifiers/ai.classifier';
import { CitationGenerator } from './generators/citation.generator';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'tax-classification',
    }),
  ],
  providers: [
    TaxClassificationService,
    TaxClassificationProcessor,
    TaxRuleEngine,
    AIClassifier,
    CitationGenerator,
  ],
  controllers: [TaxClassificationController],
  exports: [TaxClassificationService],
})
export class TaxClassificationModule {}
