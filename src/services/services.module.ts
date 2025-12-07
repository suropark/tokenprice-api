import { Module } from '@nestjs/common';
import { AggregationService } from './aggregation.service';
import { CollectorService } from './collector.service';
import { StorageService } from './storage.service';
import { FxRateService } from './fx-rate.service';
import { BackfillService } from './backfill.service';
import { ExchangeModule } from '../clients/exchange.module';
import { RedisModule } from '../config/redis.module';

@Module({
  imports: [ExchangeModule, RedisModule],
  providers: [AggregationService, CollectorService, StorageService, FxRateService, BackfillService],
  exports: [AggregationService, CollectorService, StorageService, FxRateService, BackfillService],
})
export class ServicesModule {}
