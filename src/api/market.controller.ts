import {
  Controller,
  Get,
  Query,
  ValidationPipe,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../database/prisma.service';
import { OhlcvQueryDto } from './dto/ohlcv-query.dto';
import { TickerQueryDto } from './dto/ticker-query.dto';
import { FxRateService } from '../services/fx-rate.service';
import { getExchangeMetadata, SYMBOLS } from '../config/symbols';

@Controller('api/v1/market')
export class MarketController {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly prisma: PrismaService,
    private readonly fxRateService: FxRateService,
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

  @Get('ticker')
  async getTicker(
    @Query(new ValidationPipe({ transform: true })) query: TickerQueryDto,
  ) {
    const { base, exchange, quote, includePremium } = query;

    // Case 1: Specific exchange
    if (exchange) {
      return this.getExchangePrice(base, exchange);
    }

    // Case 2: Specific quote currency
    if (quote) {
      return this.getQuoteMarket(base, quote, includePremium);
    }

    // Case 3: All markets (quote별로 분리)
    return this.getAllMarkets(base, includePremium);
  }

  /**
   * Get specific exchange price
   */
  private async getExchangePrice(base: string, exchange: string) {
    const metadata = getExchangeMetadata(base, exchange);
    if (!metadata) {
      throw new NotFoundException(
        `Exchange ${exchange} not found for ${base}`,
      );
    }

    const { quote, pair } = metadata;
    const key = `candle:${pair}:${exchange}`;
    const data = await this.redis.hgetall(key);

    if (!data || !data.c) {
      throw new NotFoundException(
        `Price not found for ${base} on ${exchange}`,
      );
    }

    return {
      base,
      exchange,
      quote,
      pair,
      price: parseFloat(data.c),
      open: parseFloat(data.o),
      high: parseFloat(data.h),
      low: parseFloat(data.l),
      volume: data.v ? parseFloat(data.v) : undefined,
      timestamp: parseInt(data.t),
    };
  }

  /**
   * Get aggregated price for specific quote market
   */
  private async getQuoteMarket(
    base: string,
    quote: string,
    includePremium: boolean,
  ) {
    const key = `candle:${base}:${quote}:aggregated`;
    const data = await this.redis.hgetall(key);

    if (!data || !data.c) {
      throw new NotFoundException(`Price not found for ${base}:${quote}`);
    }

    const result: any = {
      base,
      quote,
      price: parseFloat(data.c),
      open: parseFloat(data.o),
      high: parseFloat(data.h),
      low: parseFloat(data.l),
      volume: data.v ? parseFloat(data.v) : 0,
      timestamp: parseInt(data.t),
      sourceCount: parseInt(data.sources || '1'),
    };

    // Add premium calculation if requested
    if (includePremium && quote === 'KRW') {
      try {
        const usdtMarket = await this.getQuoteMarket(base, 'USDT', false);
        const premium = await this.fxRateService.calculatePremium(
          usdtMarket.price,
          result.price,
        );
        if (premium) {
          result.premium = premium.percentageString;
        }
      } catch (error) {
        // USDT market not available, skip premium
      }
    }

    return result;
  }

  /**
   * Get all markets (quote별 분리)
   */
  private async getAllMarkets(base: string, includePremium: boolean) {
    const markets: any = {};

    // Get each quote market separately
    for (const quote of ['USDT', 'KRW']) {
      try {
        markets[quote] = await this.getQuoteMarket(base, quote, false);
      } catch (error) {
        // Market not available
      }
    }

    if (Object.keys(markets).length === 0) {
      throw new NotFoundException(`No price data found for ${base}`);
    }

    const result: any = { base, markets };

    // Add premium if requested and both markets exist
    if (includePremium && markets['USDT'] && markets['KRW']) {
      const premium = await this.fxRateService.calculatePremium(
        markets['USDT'].price,
        markets['KRW'].price,
      );
      if (premium) {
        result.premium = {
          value: premium.percentageString,
          note: 'KRW market premium vs USDT market',
        };
      }
    }

    return result;
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
