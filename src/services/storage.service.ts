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

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly drizzle: DrizzleService,
  ) {}

  @Cron('5 * * * * *') // Every minute at :05 seconds
  async flushToDatabase() {
    try {
      // Only flush quote-aggregated candles to database
      const keys = await this.redis.keys('candle:*:*:aggregated');

      if (keys.length === 0) {
        this.logger.debug('No candles to flush');
        return;
      }

      this.logger.log(`💾 Flushing ${keys.length} candles to database`);

      for (const key of keys) {
        await this.flushCandle(key);
      }

      this.logger.log(`✅ Flushed ${keys.length} candles successfully`);
    } catch (error) {
      this.logger.error(`Flush failed: ${error.message}`, error.stack);
    }
  }

  private async flushCandle(key: string) {
    // 1. Get data from Redis
    const data = await this.redis.hgetall(key);

    if (!data || !data.o) {
      this.logger.warn(`Empty candle data for ${key}`);
      return;
    }

    // 2. Extract base and quote from key
    // Format: candle:BTC:USDT:aggregated → BTC, USDT
    const parts = key.split(':');
    if (parts.length !== 4) {
      this.logger.warn(`Invalid key format: ${key}`);
      return;
    }

    const [, base, quote] = parts;
    const symbol = `${base}:${quote}`; // Store as "BTC:USDT" in DB

    // 3. Calculate bucket time (rounded to minute)
    const bucketTime = new Date();
    bucketTime.setSeconds(0, 0);

    // 4. Get source count from data
    const sourceCount = parseInt(data.sources || '1', 10);

    // 5. Upsert to database using Drizzle
    try {
      await this.drizzle.db
        .insert(ohlcv1m)
        .values({
          time: bucketTime,
          symbol,
          open: data.o,
          high: data.h,
          low: data.l,
          close: data.c,
        } as any)
        .onConflictDoUpdate({
          target: [ohlcv1m.time, ohlcv1m.symbol],
          set: {
            close: sql.raw(`'${data.c}'`),
            high: sql`GREATEST(ohlcv_1m.high, '${sql.raw(data.h)}')`,
            low: sql`LEAST(ohlcv_1m.low, '${sql.raw(data.l)}')`,
            sourceCount: sourceCount,
          } as any,
        });

      // 6. Delete all candles for this base (all quotes + exchanges)
      // This includes: candle:BTC:USDT:aggregated, candle:BTC:KRW:aggregated,
      // candle:BTC/USDT:binance, candle:BTC/KRW:upbit
      const allKeys = await this.redis.keys(`candle:${base}*`);
      if (allKeys.length > 0) {
        await this.redis.del(...allKeys);
      }

      this.logger.debug(`Flushed ${symbol} candle (${allKeys.length} keys deleted)`);
    } catch (error) {
      this.logger.error(`Failed to flush ${symbol}: ${error.message}`);
      // Don't delete Redis key if DB write fails
    }
  }
}
