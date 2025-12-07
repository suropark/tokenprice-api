import { Injectable, Logger, Inject, Optional, forwardRef } from '@nestjs/common';
import { DrizzleService } from '../database/drizzle.service';
import { ohlcv1m } from '../database/schema';
import { BinanceClient, OHLCVData } from '../clients/binance.client';
import { UpbitClient } from '../clients/upbit.client';
import { FxRateService } from './fx-rate.service';
import { StorageService } from './storage.service';
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
    @Optional()
    private readonly fxRateService?: FxRateService,
    @Optional()
    @Inject(forwardRef(() => StorageService))
    private readonly storageService?: StorageService,
  ) {}

  /**
   * Backfill historical data for a symbol
   * Processes data day by day to reduce memory usage and improve progress tracking
   */
  async backfill(options: BackfillOptions): Promise<BackfillProgress> {
    const { base, startDate, endDate, exchanges = ['binance', 'upbit'] } = options;

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
      // Pause flush operations during backfill (if StorageService is available)
      if (this.storageService) {
        this.storageService.setBackfilling(true);
      }

      const startTime = startDate.getTime();
      const endTime = endDate.getTime();

      // Calculate total expected candles (1 per minute)
      const totalMinutes = Math.floor((endTime - startTime) / (60 * 1000));
      progress.totalCandles = totalMinutes;

      // Calculate number of days
      const totalDays = Math.ceil((endTime - startTime) / (24 * 60 * 60 * 1000));
      this.logger.log(`Processing ${totalDays} days in daily batches...`);

      // Process day by day
      let currentDate = new Date(startDate);
      let dayNumber = 0;

      while (currentDate < endDate) {
        dayNumber++;
        const dayStart = new Date(currentDate);
        dayStart.setHours(0, 0, 0, 0);
        
        const dayEnd = new Date(dayStart);
        dayEnd.setHours(23, 59, 59, 999);
        
        // Don't exceed the end date
        if (dayEnd > endDate) {
          dayEnd.setTime(endDate.getTime());
        }

        const dayStartTime = dayStart.getTime();
        const dayEndTime = dayEnd.getTime();

        this.logger.log(
          `📅 Processing day ${dayNumber}/${totalDays}: ${dayStart.toISOString().split('T')[0]}`,
        );

        // Fetch data from exchanges for this day
        const exchangeData = new Map<string, OHLCVData[]>();

        if (exchanges.includes('binance')) {
          this.logger.log(`  Fetching Binance data for ${base}/USDT...`);
          const binanceData = await this.binanceClient.getHistoricalDataRange(
            `${base}/USDT`,
            dayStartTime,
            dayEndTime,
          );
          exchangeData.set('binance', binanceData);
          this.logger.log(`  ✅ Fetched ${binanceData.length} candles from Binance`);
        }

        if (exchanges.includes('upbit')) {
          this.logger.log(`  Fetching Upbit data for ${base}/KRW...`);
          const upbitData = await this.upbitClient.getHistoricalDataRange(
            `${base}/KRW`,
            dayStartTime,
            dayEndTime,
          );
          exchangeData.set('upbit', upbitData);
          this.logger.log(`  ✅ Fetched ${upbitData.length} candles from Upbit`);
        }

        // Aggregate and store data for this day
        const dayProgress = {
          ...progress,
          processedCandles: 0,
        };
        await this.aggregateAndStore(base, exchangeData, dayProgress);
        progress.processedCandles += dayProgress.processedCandles;

        this.logger.log(
          `  ✅ Day ${dayNumber}/${totalDays} completed: ${dayProgress.processedCandles} candles stored (Total: ${progress.processedCandles}/${progress.totalCandles})`,
        );

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }

      progress.status = 'completed';
      this.logger.log(
        `✅ Backfill completed for ${base}: ${progress.processedCandles} candles processed across ${totalDays} days`,
      );
    } catch (error) {
      progress.status = 'failed';
      progress.error = error.message;
      this.logger.error(`❌ Backfill failed for ${base}: ${error.message}`);
      throw error;
    } finally {
      // Resume flush operations after backfill (if StorageService is available)
      if (this.storageService) {
        this.storageService.setBackfilling(false);
      }
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
    const batchSize = 5000; // Increased batch size for better performance with large datasets
    const logInterval = 10000; // Log progress every 10k records
    const startTime = Date.now();

    this.logger.log(
      `Starting to store ${sortedTimes.length} time buckets in batches of ${batchSize}...`,
    );

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
        const batchStartTime = Date.now();
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

        const batchDuration = Date.now() - batchStartTime;
        const elapsed = Date.now() - startTime;
        const rate = progress.processedCandles / (elapsed / 1000); // records per second

        // Log progress at intervals or for every batch if small dataset
        if (
          progress.processedCandles % logInterval < batchSize ||
          i + batchSize >= sortedTimes.length
        ) {
          const percentage = (
            (progress.processedCandles / progress.totalCandles) *
            100
          ).toFixed(1);
          this.logger.log(
            `💾 Inserted batch ${Math.floor(i / batchSize) + 1}: ${values.length} records | ` +
              `Progress: ${progress.processedCandles}/${progress.totalCandles} (${percentage}%) | ` +
              `Rate: ${rate.toFixed(0)} rec/s | ` +
              `Batch time: ${batchDuration}ms`,
          );
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    const avgRate = progress.processedCandles / (totalDuration / 1000);
    this.logger.log(
      `✅ Storage completed: ${progress.processedCandles} records in ${(totalDuration / 1000).toFixed(1)}s (avg ${avgRate.toFixed(0)} rec/s)`,
    );
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
