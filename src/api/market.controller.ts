import { Controller, Get, Query, ValidationPipe, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../database/prisma.service';
import { OhlcvQueryDto } from './dto/ohlcv-query.dto';

@Controller('api/v1/market')
export class MarketController {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  @Get('ohlcv')
  async getOhlcv(@Query(new ValidationPipe({ transform: true })) query: OhlcvQueryDto) {
    const { symbol, from, to } = query;

    // 1. Get historical data from DB
    const historical = await this.prisma.ohlcv1m.findMany({
      where: {
        symbol,
        time: {
          gte: new Date(from * 1000),
          lte: new Date(to * 1000),
        },
      },
      orderBy: { time: 'asc' },
    });

    // 2. Format historical data
    let result = historical.map((h) => ({
      time: Math.floor(h.time.getTime() / 1000),
      open: parseFloat(h.open.toString()),
      high: parseFloat(h.high.toString()),
      low: parseFloat(h.low.toString()),
      close: parseFloat(h.close.toString()),
      volume: parseFloat(h.volume.toString()),
    }));

    // 3. Get current candle from Redis (if within range)
    const now = Date.now() / 1000;
    if (to >= now) {
      const current = await this.redis.hgetall(`candle:${symbol}`);

      if (current && current.o) {
        result.push({
          time: Math.floor(parseInt(current.t) / 1000),
          open: parseFloat(current.o),
          high: parseFloat(current.h),
          low: parseFloat(current.l),
          close: parseFloat(current.c),
          volume: 0,
        });
      }
    }

    return {
      symbol,
      data: result,
      meta: {
        count: result.length,
        from,
        to,
      },
    };
  }

  @Get('symbols')
  async getSymbols() {
    const symbols = await this.prisma.ohlcv1m.groupBy({
      by: ['symbol'],
      _count: {
        symbol: true,
      },
    });

    return {
      symbols: symbols.map((s) => s.symbol),
      count: symbols.length,
    };
  }

  @Get('health')
  async getHealth() {
    try {
      // Check database
      await this.prisma.$queryRaw`SELECT 1`;

      // Check Redis
      await this.redis.ping();

      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          database: 'connected',
          redis: 'connected',
        },
      };
    } catch (error) {
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message,
      };
    }
  }
}
