import { Module } from '@nestjs/common';
import { BinanceClient } from './binance.client';
import { UpbitClient } from './upbit.client';

@Module({
  providers: [BinanceClient, UpbitClient],
  exports: [BinanceClient, UpbitClient],
})
export class ExchangeModule {}
