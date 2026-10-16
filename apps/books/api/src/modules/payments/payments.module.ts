import { Module } from '@nestjs/common';
import { PaymentsController, PaymentWebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeProvider } from './providers/stripe.provider';
import { SquareProvider } from './providers/square.provider';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [PaymentsService, StripeProvider, SquareProvider],
  exports: [PaymentsService],
})
export class PaymentsModule {}
