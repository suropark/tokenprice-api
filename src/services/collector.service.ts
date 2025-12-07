import { Injectable, Logger, OnModuleInit, Inject } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import Redis from 'ioredis';
import { BinanceClient } from '../clients/binance.client';
import { UpbitClient } from '../clients/upbit.client';
import { AggregationService } from './aggregation.service';
import { SYMBOLS } from '../config/symbols';

export interface CollectionStatus {
  isRunning: boolean;
  lastCollectionTime: number | null;
  symbols: Record<
    string,
    {
      lastCollectionTime: number | null;
      markets: Record<
        string,
        {
          lastCollectionTime: number | null;
          exchanges: Record<
            string,
            {
              lastCollectionTime: number | null;
              lastError?: string;
              errorCount: number;
            }
          >;
        }
      >;
    }
  >;
  totalErrors: number;
}

@Injectable()
export class CollectorService implements OnModuleInit {
  private readonly logger = new Logger(CollectorService.name);
  private collectionStatus: CollectionStatus = {
    isRunning: false,
    lastCollectionTime: null,
    symbols: {},
    totalErrors: 0,
  };

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly binance: BinanceClient,
    private readonly upbit: UpbitClient,
    private readonly aggregator: AggregationService,
  ) {
    // Initialize status for all symbols
    for (const symbolConfig of SYMBOLS) {
      this.collectionStatus.symbols[symbolConfig.base] = {
        lastCollectionTime: null,
        markets: {},
      };
      for (const [quote, marketConfig] of Object.entries(symbolConfig.markets)) {
        this.collectionStatus.symbols[symbolConfig.base].markets[quote] = {
          lastCollectionTime: null,
          exchanges: {},
        };
        for (const exchangeConfig of marketConfig.exchanges) {
          this.collectionStatus.symbols[symbolConfig.base].markets[quote].exchanges[
            exchangeConfig.name
          ] = {
            lastCollectionTime: null,
            errorCount: 0,
          };
        }
      }
    }
  }

  onModuleInit() {
    const bases = SYMBOLS.map((s) => s.base).join(', ');
    this.logger.log(`📊 Initialized with symbols: ${bases}`);
  }

  /**
   * Get current collection status
   */
  public getStatus(): CollectionStatus {
    const status: CollectionStatus = {
      isRunning: this.collectionStatus.isRunning,
      lastCollectionTime: this.collectionStatus.lastCollectionTime,
      symbols: JSON.parse(JSON.stringify(this.collectionStatus.symbols)),
      totalErrors: this.collectionStatus.totalErrors,
    };
    return status;
  }

  @Cron(CronExpression.EVERY_SECOND)
  async collectPrices() {
    this.collectionStatus.isRunning = true;
    const startTime = Date.now();

    try {
      for (const symbolConfig of SYMBOLS) {
        try {
          await this.collectSymbol(symbolConfig);
        } catch (error) {
          this.logger.error(`Failed to collect ${symbolConfig.base}: ${error.message}`);
          this.collectionStatus.totalErrors++;
        }
      }
      this.collectionStatus.lastCollectionTime = startTime;
    } catch (error) {
      this.logger.error(`Collection cycle failed: ${error.message}`);
      this.collectionStatus.totalErrors++;
    } finally {
      this.collectionStatus.isRunning = false;
    }
  }

  private async collectSymbol(symbolConfig: (typeof SYMBOLS)[0]) {
    const { base, markets } = symbolConfig;
    const symbolStatus = this.collectionStatus.symbols[base];
    const symbolStartTime = Date.now();

    // Collect for each quote market separately
    for (const [quote, marketConfig] of Object.entries(markets)) {
      try {
        await this.collectMarket(base, quote, marketConfig);
        if (symbolStatus.markets[quote]) {
          symbolStatus.markets[quote].lastCollectionTime = symbolStartTime;
        }
      } catch (error) {
        this.logger.error(`Failed to collect ${base}:${quote}: ${error.message}`);
        this.collectionStatus.totalErrors++;
      }
    }

    symbolStatus.lastCollectionTime = symbolStartTime;
  }

  private async collectMarket(
    base: string,
    quote: string,
    marketConfig: (typeof SYMBOLS)[0]['markets'][string],
  ) {
    const exchangeStatus = this.collectionStatus.symbols[base]?.markets[quote]?.exchanges;
    const pricePromises = marketConfig.exchanges.map(async (exchangeConfig) => {
      const { name, pair } = exchangeConfig;
      const exchangeStartTime = Date.now();

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
        await this.updateExchangeRedis(pair, name, priceData.price, priceData.volume);

        // Update status on success
        if (exchangeStatus?.[name]) {
          exchangeStatus[name].lastCollectionTime = exchangeStartTime;
          exchangeStatus[name].lastError = undefined;
        }

        return priceData;
      } catch (error) {
        this.logger.warn(`Failed to fetch ${pair} from ${name}: ${error.message}`);
        // Update error status
        if (exchangeStatus?.[name]) {
          exchangeStatus[name].errorCount++;
          exchangeStatus[name].lastError = error.message;
        }
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
    await this.updateQuoteAggregatedRedis(base, quote, aggregated.price, aggregated.sourceCount);

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
