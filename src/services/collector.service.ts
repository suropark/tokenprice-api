import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { BinanceClient } from '../clients/binance.client';
import { UpbitClient } from '../clients/upbit.client';
import { AggregationService } from './aggregation.service';
import { AppConfig } from '../config/configuration';

@Injectable()
export class CollectorService implements OnModuleInit {
  private readonly logger = new Logger(CollectorService.name);
  private symbols: string[];

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly config: ConfigService<AppConfig>,
    private readonly binance: BinanceClient,
    private readonly upbit: UpbitClient,
    private readonly aggregator: AggregationService,
  ) {
    this.symbols = this.config.get<string[]>('symbols', []);
  }

  onModuleInit() {
    this.logger.log(`📊 Initialized with symbols: ${this.symbols.join(', ')}`);
  }

  @Cron(CronExpression.EVERY_SECOND)
  async collectPrices() {
    for (const symbol of this.symbols) {
      try {
        await this.collectSymbol(symbol);
      } catch (error) {
        this.logger.error(`Failed to collect ${symbol}: ${error.message}`);
      }
    }
  }

  private async collectSymbol(symbol: string) {
    // 1. Fetch from exchanges
    const [binanceData, upbitData] = await Promise.all([
      this.binance.getPrice(symbol),
      this.upbit.getPrice(symbol),
    ]);

    // 2. Filter valid data
    const validData = [binanceData, upbitData].filter((d) => d !== null);

    if (validData.length === 0) {
      this.logger.warn(`No valid prices for ${symbol}`);
      return;
    }

    // 3. Aggregate
    const aggregated = this.aggregator.aggregate(validData);

    // 4. Update Redis
    await this.updateRedis(symbol, aggregated.price);

    this.logger.debug(
      `${symbol}: ${aggregated.price.toFixed(2)} (${aggregated.algorithm}, ${aggregated.sourceCount} sources)`,
    );
  }

  private async updateRedis(symbol: string, price: number) {
    const key = `candle:${symbol}`;

    // Check if candle exists
    const exists = await this.redis.exists(key);

    if (!exists) {
      // Create new candle
      await this.redis.hset(key, {
        o: price.toString(),
        h: price.toString(),
        l: price.toString(),
        c: price.toString(),
        t: Date.now().toString(),
      });
    } else {
      // Update existing candle
      const [high, low] = await this.redis.hmget(key, 'h', 'l');

      await this.redis.hset(key, {
        h: Math.max(parseFloat(high), price).toString(),
        l: Math.min(parseFloat(low), price).toString(),
        c: price.toString(),
      });
    }
  }
}
