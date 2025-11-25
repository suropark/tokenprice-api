import { Module } from '@nestjs/common';
import { AggregationService } from './aggregation.service';
import { CollectorService } from './collector.service';
import { ExchangeModule } from '../clients/exchange.module';

@Module({
  imports: [ExchangeModule],
  providers: [AggregationService, CollectorService],
  exports: [AggregationService, CollectorService],
})
export class ServicesModule {}
