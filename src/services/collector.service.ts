import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import Redis from 'ioredis';
import { BinanceClient } from '../clients/binance.client';
import { UpbitClient } from '../clients/upbit.client';
import { AggregationService } from './aggregation.service';
import { SYMBOLS, getMarketExchanges } from '../config/symbols';

@Injectable()
export class CollectorService implements OnModuleInit {
  private readonly logger = new Logger(CollectorService.name);

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly binance: BinanceClient,
    private readonly upbit: UpbitClient,
    private readonly aggregator: AggregationService,
  ) {}

  onModuleInit() {
    const bases = SYMBOLS.map((s) => s.base).join(', ');
    this.logger.log(`📊 Initialized with symbols: ${bases}`);
  }

  @Cron(CronExpression.EVERY_SECOND)
  async collectPrices() {
    for (const symbolConfig of SYMBOLS) {
      try {
        await this.collectSymbol(symbolConfig);
      } catch (error) {
        this.logger.error(
          `Failed to collect ${symbolConfig.base}: ${error.message}`,
        );
      }
    }
  }

  private async collectSymbol(symbolConfig: typeof SYMBOLS[0]) {
    const { base, markets } = symbolConfig;

    // Collect for each quote market separately
    for (const [quote, marketConfig] of Object.entries(markets)) {
      try {
        await this.collectMarket(base, quote, marketConfig);
      } catch (error) {
        this.logger.error(
          `Failed to collect ${base}:${quote}: ${error.message}`,
        );
      }
    }
  }

  private async collectMarket(
    base: string,
    quote: string,
    marketConfig: typeof SYMBOLS[0]['markets'][string],
  ) {
    const pricePromises = marketConfig.exchanges.map(async (exchangeConfig) => {
      const { name, pair } = exchangeConfig;

      try {
        // Fetch price from exchange
        let priceData = null;
        if (name === 'binance') {
          priceData = await this.binance.getPrice(pair);
        } else if (name === 'upbit') {
          priceData = await this.upbit.getPrice(pair);
        }

        if (!priceData) return null;

        // Store individual exchange price
        await this.updateExchangeRedis(
          pair,
          name,
          priceData.price,
          priceData.volume,
        );

        return priceData;
      } catch (error) {
        this.logger.warn(`Failed to fetch ${pair} from ${name}: ${error.message}`);
        return null;
      }
    });

    // Wait for all exchanges in this market
    const results = await Promise.all(pricePromises);
    const validData = results.filter((d) => d !== null);

    if (validData.length === 0) {
      this.logger.warn(`No valid prices for ${base}:${quote}`);
      return;
    }

    // Aggregate only same-quote exchanges
    const aggregated = this.aggregator.aggregate(validData);

    // Store quote-separated aggregated candle
    await this.updateQuoteAggregatedRedis(
      base,
      quote,
      aggregated.price,
      aggregated.sourceCount,
    );

    this.logger.debug(
      `${base}:${quote}: ${aggregated.price.toFixed(2)} (${aggregated.algorithm}, ${aggregated.sourceCount} sources)`,
    );
  }

  /**
   * Update Redis candle for quote-aggregated data
   */
  private async updateQuoteAggregatedRedis(
    base: string,
    quote: string,
    price: number,
    sourceCount: number,
  ) {
    const key = `candle:${base}:${quote}:aggregated`;

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
        sources: sourceCount.toString(),
      });
    } else {
      // Update existing candle
      const [high, low] = await this.redis.hmget(key, 'h', 'l');

      await this.redis.hset(key, {
        h: Math.max(parseFloat(high), price).toString(),
        l: Math.min(parseFloat(low), price).toString(),
        c: price.toString(),
        sources: sourceCount.toString(),
      });
    }
  }

  /**
   * Update Redis candle for individual exchange
   */
  private async updateExchangeRedis(
    symbol: string,
    exchange: string,
    price: number,
    volume: number,
  ) {
    const key = `candle:${symbol}:${exchange}`;

    // Check if candle exists
    const exists = await this.redis.exists(key);

    if (!exists) {
      // Create new candle
      await this.redis.hset(key, {
        o: price.toString(),
        h: price.toString(),
        l: price.toString(),
        c: price.toString(),
        v: volume.toString(),
        t: Date.now().toString(),
      });
    } else {
      // Update existing candle
      const [high, low] = await this.redis.hmget(key, 'h', 'l');

      await this.redis.hset(key, {
        h: Math.max(parseFloat(high), price).toString(),
        l: Math.min(parseFloat(low), price).toString(),
        c: price.toString(),
        v: volume.toString(),
      });
    }
  }
}
