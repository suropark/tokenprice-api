import { Module } from '@nestjs/common';
import { AggregationService } from './aggregation.service';
import { CollectorService } from './collector.service';
import { StorageService } from './storage.service';
import { ExchangeModule } from '../clients/exchange.module';

@Module({
  imports: [ExchangeModule],
  providers: [AggregationService, CollectorService, StorageService],
  exports: [AggregationService, CollectorService, StorageService],
})
export class ServicesModule {}
