import { Module } from '@nestjs/common';
import { AggregationService } from './aggregation.service';
import { CollectorService } from './collector.service';
import { StorageService } from './storage.service';
import { FxRateService } from './fx-rate.service';
import { ExchangeModule } from '../clients/exchange.module';

@Module({
  imports: [ExchangeModule],
  providers: [
    AggregationService,
    CollectorService,
    StorageService,
    FxRateService,
  ],
  exports: [AggregationService, CollectorService, StorageService, FxRateService],
})
export class ServicesModule {}
