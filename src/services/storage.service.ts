import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { DrizzleService } from '../database/drizzle.service';
import { ohlcv1m } from '../database/schema';
import { eq, and, sql } from 'drizzle-orm';
import { SYMBOLS } from '../config/symbols';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private isBackfilling = false;

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly drizzle: DrizzleService,
  ) {}

  /**
   * Set backfill status to prevent flush during backfill
   */
  setBackfilling(status: boolean) {
    this.isBackfilling = status;
    if (status) {
      this.logger.log('⏸️  Backfill in progress - pausing flush operations');
    } else {
      this.logger.log('▶️  Backfill completed - resuming flush operations');
    }
  }

  @Cron('*/30 * * * * *') // Every 30 seconds
  async flushToDatabase() {
    // Skip flush during backfill to avoid conflicts
    if (this.isBackfilling) {
      this.logger.debug('Skipping flush - backfill in progress');
      return;
    }

    try {
      // Only flush quote-aggregated candles to database
      const keys = await this.redis.keys('candle:*:*:aggregated');

      if (keys.length === 0) {
        this.logger.debug('No candles to flush');
        return;
      }

      this.logger.log(`💾 Flushing ${keys.length} candles to database`);

      let flushedCount = 0;
      let skippedCount = 0;

      for (const key of keys) {
        const result = await this.flushCandle(key);
        if (result) {
          flushedCount++;
        } else {
          skippedCount++;
        }
      }

      if (flushedCount > 0) {
        this.logger.log(`✅ Flushed ${flushedCount} candles successfully${skippedCount > 0 ? `, skipped ${skippedCount} empty candles` : ''}`);
      } else {
        this.logger.warn(`⚠️ No candles were flushed (all ${keys.length} candles were empty or invalid)`);
      }
    } catch (error) {
      this.logger.error(`Flush failed: ${error.message}`, error.stack);
    }
  }

  private async flushCandle(key: string): Promise<boolean> {
    // 1. Get data from Redis
    const data = await this.redis.hgetall(key);

    if (!data || !data.o || !data.c) {
      this.logger.debug(`Empty candle data for ${key} - skipping`);
      return false;
    }

    // 2. Extract base and quote from key
    // Format: candle:BTC:USDT:aggregated → BTC, USDT
    const parts = key.split(':');
    if (parts.length !== 4) {
      this.logger.warn(`Invalid key format: ${key}`);
      return false;
    }

    const [, base, quote] = parts;
    const symbol = `${base}:${quote}`; // Store as "BTC:USDT" in DB

    // 3. Calculate bucket time (rounded to minute) - use timestamp from Redis if available
    let bucketTime: Date;
    if (data.t) {
      // Use timestamp from Redis data (when candle was created)
      const timestamp = parseInt(data.t, 10);
      bucketTime = new Date(timestamp);
      bucketTime.setSeconds(0, 0);
      bucketTime.setMilliseconds(0);
    } else {
      // Fallback to current time
      bucketTime = new Date();
      bucketTime.setSeconds(0, 0);
      bucketTime.setMilliseconds(0);
    }

    // 4. Get source count from data
    const sourceCount = parseInt(data.sources || '1', 10);

    // 5. Parse price values
    const open = parseFloat(data.o);
    const high = parseFloat(data.h);
    const low = parseFloat(data.l);
    const close = parseFloat(data.c);

    if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close)) {
      this.logger.warn(`Invalid price data for ${key}: o=${data.o}, h=${data.h}, l=${data.l}, c=${data.c}`);
      return false;
    }

    // 6. Upsert to database using Drizzle
    try {
      await this.drizzle.db
        .insert(ohlcv1m)
        .values({
          time: bucketTime,
          symbol,
          open: open.toString(),
          high: high.toString(),
          low: low.toString(),
          close: close.toString(),
          volume: '0',
          quoteVolume: '0',
          sourceCount: sourceCount,
        } as any)
        .onConflictDoUpdate({
          target: [ohlcv1m.time, ohlcv1m.symbol],
          set: {
            close: sql.raw('EXCLUDED.close'),
            high: sql`GREATEST(ohlcv_1m.high, EXCLUDED.high)`,
            low: sql`LEAST(ohlcv_1m.low, EXCLUDED.low)`,
            sourceCount: sql.raw('EXCLUDED.source_count'),
          } as any,
        });

      // 7. Delete all candles for this base (all quotes + exchanges)
      // This includes: candle:BTC:USDT:aggregated, candle:BTC:KRW:aggregated,
      // candle:BTC/USDT:binance, candle:BTC/KRW:upbit
      const allKeys = await this.redis.keys(`candle:${base}*`);
      if (allKeys.length > 0) {
        await this.redis.del(...allKeys);
      }

      this.logger.log(
        `✅ Flushed ${symbol} at ${bucketTime.toISOString()} (price: ${close.toFixed(2)}, ${allKeys.length} keys deleted)`,
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to flush ${symbol}: ${error.message}`, error.stack);
      // Don't delete Redis key if DB write fails
      return false;
    }
  }
}
