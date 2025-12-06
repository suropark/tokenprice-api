import { Injectable, Logger } from '@nestjs/common';
import { DrizzleService } from '../database/drizzle.service';
import { ohlcv1m } from '../database/schema';
import { BinanceClient, OHLCVData } from '../clients/binance.client';
import { UpbitClient } from '../clients/upbit.client';
import { FxRateService } from './fx-rate.service';
import { sql } from 'drizzle-orm';

export interface BackfillOptions {
  base: string; // e.g., 'BTC'
  startDate: Date;
  endDate: Date;
  exchanges?: string[]; // Optional, defaults to all supported exchanges
}

export interface BackfillProgress {
  base: string;
  startDate: Date;
  endDate: Date;
  totalCandles: number;
  processedCandles: number;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

@Injectable()
export class BackfillService {
  private readonly logger = new Logger(BackfillService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly binanceClient: BinanceClient,
    private readonly upbitClient: UpbitClient,
    private readonly fxRateService: FxRateService,
  ) {}

  /**
   * Backfill historical data for a symbol
   */
  async backfill(options: BackfillOptions): Promise<BackfillProgress> {
    const { base, startDate, endDate, exchanges = ['binance', 'upbit'] } =
      options;

    this.logger.log(
      `Starting backfill for ${base} from ${startDate.toISOString()} to ${endDate.toISOString()}`,
    );

    const progress: BackfillProgress = {
      base,
      startDate,
      endDate,
      totalCandles: 0,
      processedCandles: 0,
      status: 'running',
    };

    try {
      const startTime = startDate.getTime();
      const endTime = endDate.getTime();

      // Calculate total expected candles (1 per minute)
      const totalMinutes = Math.floor((endTime - startTime) / (60 * 1000));
      progress.totalCandles = totalMinutes;

      // Fetch data from exchanges
      const exchangeData = new Map<string, OHLCVData[]>();

      if (exchanges.includes('binance')) {
        this.logger.log(`Fetching Binance data for ${base}/USDT...`);
        const binanceData = await this.binanceClient.getHistoricalDataRange(
          `${base}/USDT`,
          startTime,
          endTime,
        );
        exchangeData.set('binance', binanceData);
        this.logger.log(`Fetched ${binanceData.length} candles from Binance`);
      }

      if (exchanges.includes('upbit')) {
        this.logger.log(`Fetching Upbit data for ${base}/KRW...`);
        const upbitData = await this.upbitClient.getHistoricalDataRange(
          `${base}/KRW`,
          startTime,
          endTime,
        );
        exchangeData.set('upbit', upbitData);
        this.logger.log(`Fetched ${upbitData.length} candles from Upbit`);
      }

      // Aggregate and store data
      await this.aggregateAndStore(base, exchangeData, progress);

      progress.status = 'completed';
      this.logger.log(
        `Backfill completed for ${base}: ${progress.processedCandles} candles processed`,
      );
    } catch (error) {
      progress.status = 'failed';
      progress.error = error.message;
      this.logger.error(`Backfill failed for ${base}: ${error.message}`);
      throw error;
    }

    return progress;
  }

  /**
   * Aggregate data from multiple exchanges and store in database
   */
  private async aggregateAndStore(
    base: string,
    exchangeData: Map<string, OHLCVData[]>,
    progress: BackfillProgress,
  ): Promise<void> {
    // Create time-indexed map for aggregation
    const timeMap = new Map<number, Map<string, OHLCVData>>();

    // Organize data by timestamp
    for (const [exchange, candles] of exchangeData) {
      for (const candle of candles) {
        const bucketTime = this.roundToMinute(candle.time);
        if (!timeMap.has(bucketTime)) {
          timeMap.set(bucketTime, new Map());
        }
        timeMap.get(bucketTime)!.set(exchange, candle);
      }
    }

    // Process each time bucket
    const sortedTimes = Array.from(timeMap.keys()).sort((a, b) => a - b);
    const batchSize = 100; // Insert in batches for better performance

    for (let i = 0; i < sortedTimes.length; i += batchSize) {
      const batch = sortedTimes.slice(i, i + batchSize);
      const values = [];

      for (const time of batch) {
        const exchangeCandles = timeMap.get(time)!;
        const binanceCandle = exchangeCandles.get('binance');
        const upbitCandle = exchangeCandles.get('upbit');

        // Aggregate USDT market
        if (binanceCandle) {
          values.push({
            time: new Date(time),
            symbol: `${base}:USDT`,
            open: binanceCandle.open.toString(),
            high: binanceCandle.high.toString(),
            low: binanceCandle.low.toString(),
            close: binanceCandle.close.toString(),
            volume: binanceCandle.volume.toString(),
            quoteVolume: binanceCandle.quoteVolume.toString(),
            sourceCount: 1,
          });
        }

        // Aggregate KRW market
        if (upbitCandle) {
          values.push({
            time: new Date(time),
            symbol: `${base}:KRW`,
            open: upbitCandle.open.toString(),
            high: upbitCandle.high.toString(),
            low: upbitCandle.low.toString(),
            close: upbitCandle.close.toString(),
            volume: upbitCandle.volume.toString(),
            quoteVolume: upbitCandle.quoteVolume.toString(),
            sourceCount: 1,
          });
        }

        progress.processedCandles++;
      }

      // Batch insert with conflict resolution
      if (values.length > 0) {
        await this.drizzle.db
          .insert(ohlcv1m)
          .values(values as any)
          .onConflictDoUpdate({
            target: [ohlcv1m.time, ohlcv1m.symbol],
            set: {
              close: sql.raw('EXCLUDED.close'),
              high: sql`GREATEST(ohlcv_1m.high, EXCLUDED.high)`,
              low: sql`LEAST(ohlcv_1m.low, EXCLUDED.low)`,
              volume: sql.raw('EXCLUDED.volume'),
              quoteVolume: sql.raw('EXCLUDED.quote_volume'),
            } as any,
          });

        this.logger.debug(
          `Inserted batch ${i / batchSize + 1}: ${values.length} records (${progress.processedCandles}/${progress.totalCandles})`,
        );
      }
    }
  }

  /**
   * Round timestamp to the start of the minute
   */
  private roundToMinute(timestamp: number): number {
    return Math.floor(timestamp / 60000) * 60000;
  }

  /**
   * Backfill last N days for a symbol
   */
  async backfillLastDays(
    base: string,
    days: number,
    exchanges?: string[],
  ): Promise<BackfillProgress> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    return this.backfill({
      base,
      startDate,
      endDate,
      exchanges,
    });
  }

  /**
   * Backfill last N hours for a symbol
   */
  async backfillLastHours(
    base: string,
    hours: number,
    exchanges?: string[],
  ): Promise<BackfillProgress> {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - hours * 60 * 60 * 1000);

    return this.backfill({
      base,
      startDate,
      endDate,
      exchanges,
    });
  }
}
