import { Injectable, Logger, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import Redis from 'ioredis';
import { UpbitClient } from '../clients/upbit.client';

@Injectable()
export class FxRateService {
  private readonly logger = new Logger(FxRateService.name);

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly upbitClient: UpbitClient,
  ) {}

  /**
   * Update USDT/KRW rate every 1 minute (김치 프리미엄 반영된 시장가)
   */
  @Cron('*/1 * * * *')
  async updateUsdtKrwRate() {
    try {
      const usdtKrw = await this.upbitClient.getPrice('USDT/KRW');
      if (usdtKrw) {
        await this.setRate('USDT', 'KRW', usdtKrw.price, 'upbit');
        this.logger.debug(`Updated USDT/KRW rate: ${usdtKrw.price}`);
      }
    } catch (error) {
      this.logger.error(`Failed to update USDT/KRW rate: ${error.message}`);
    }
  }

  /**
   * Get FX rate (참고용)
   */
  async getRate(from: string, to: string): Promise<number | null> {
    if (from === to) return 1;

    // Try direct rate
    const direct = await this.redis.hget(`fx:${from}:${to}`, 'rate');
    if (direct) return parseFloat(direct);

    // Try inverse rate
    const inverse = await this.redis.hget(`fx:${to}:${from}`, 'rate');
    if (inverse) return 1 / parseFloat(inverse);

    return null;
  }

  /**
   * Calculate kimchi premium (김치 프리미엄 계산)
   */
  async calculatePremium(
    usdtPrice: number,
    krwPrice: number,
  ): Promise<{ premium: number; percentageString: string } | null> {
    const usdtKrwRate = await this.getRate('USDT', 'KRW');
    if (!usdtKrwRate) return null;

    const expectedKrwPrice = usdtPrice * usdtKrwRate;
    const premium = ((krwPrice - expectedKrwPrice) / expectedKrwPrice) * 100;

    return {
      premium,
      percentageString: `${premium > 0 ? '+' : ''}${premium.toFixed(2)}%`,
    };
  }

  private async setRate(from: string, to: string, rate: number, source: string) {
    await this.redis.hset(`fx:${from}:${to}`, {
      rate: rate.toString(),
      timestamp: Date.now().toString(),
      source,
    });
    await this.redis.expire(`fx:${from}:${to}`, 86400); // 24 hour TTL
  }
}
