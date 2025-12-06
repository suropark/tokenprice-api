import { Module } from '@nestjs/common';
import { MarketController } from './market.controller';
import { BackfillController } from './backfill.controller';

@Module({
  controllers: [MarketController, BackfillController],
})
export class ApiModule {}
