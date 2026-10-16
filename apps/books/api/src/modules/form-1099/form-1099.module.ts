import { Module } from '@nestjs/common';
import { Form1099Controller } from './form-1099.controller';
import { Form1099Service } from './form-1099.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [Form1099Controller],
  providers: [Form1099Service],
  exports: [Form1099Service],
})
export class Form1099Module {}
