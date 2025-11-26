import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  @Cron('5 * * * * *') // Every minute at :05 seconds
  async flushToDatabase() {
    try {
      const keys = await this.redis.keys('candle:*');

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

    // 2. Extract symbol from key
    const symbol = key.replace('candle:', '');

    // 3. Calculate bucket time (rounded to minute)
    const bucketTime = new Date();
    bucketTime.setSeconds(0, 0);

    // 4. Upsert to database
    try {
      await this.prisma.ohlcv1m.upsert({
        where: {
          time_symbol: {
            time: bucketTime,
            symbol,
          },
        },
        create: {
          time: bucketTime,
          symbol,
          open: parseFloat(data.o),
          high: parseFloat(data.h),
          low: parseFloat(data.l),
          close: parseFloat(data.c),
          volume: 0,
          quoteVolume: 0,
          sourceCount: 2, // Binance + Upbit
        },
        update: {
          close: parseFloat(data.c),
          high: parseFloat(data.h),
          low: parseFloat(data.l),
        },
      });

      // 5. Delete Redis key (start new candle)
      await this.redis.del(key);

      this.logger.debug(`Flushed ${symbol} candle`);
    } catch (error) {
      this.logger.error(`Failed to flush ${symbol}: ${error.message}`);
      // Don't delete Redis key if DB write fails
    }
  }
}
