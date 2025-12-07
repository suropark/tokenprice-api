import { Module } from '@nestjs/common';
import { MarketController } from './market.controller';
import { BackfillController } from './backfill.controller';
import { StatusController } from './status.controller';
import { ServicesModule } from '../services/services.module';

@Module({
  imports: [ServicesModule],
  controllers: [MarketController, BackfillController, StatusController],
})
export class ApiModule {}
