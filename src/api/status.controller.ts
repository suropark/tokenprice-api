import { Controller, Get, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { DrizzleService } from '../database/drizzle.service';
import { CollectorService, CollectionStatus } from '../services/collector.service';
import { sql } from 'drizzle-orm';
import { SYMBOLS } from '../config/symbols';

interface EndpointStatus {
  path: string;
  method: string;
  status: 'ok' | 'error';
  responseTime?: number;
  lastChecked?: string;
  error?: string;
}

interface ExchangeDataStatus {
  exchange: string;
  pair: string;
  hasData: boolean;
  lastUpdate?: number;
  price?: number;
}

interface MarketDataStatus {
  base: string;
  quote: string;
  hasData: boolean;
  lastUpdate?: number;
  price?: number;
  sourceCount?: number;
}

@Controller('api/v1/status')
export class StatusController {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly drizzle: DrizzleService,
    private readonly collectorService: CollectorService,
  ) {}

  @Get()
  async getStatus() {
    const timestamp = new Date().toISOString();

    // Check endpoints status
    const endpoints = await this.checkEndpoints();

    // Check data collection status
    const collection = this.collectorService.getStatus();

    // Check data availability in Redis
    const dataStatus = await this.checkDataStatus();

    // Check database status
    const databaseStatus = await this.checkDatabaseStatus();

    // Check Redis status
    const redisStatus = await this.checkRedisStatus();

    return {
      timestamp,
      status: this.determineOverallStatus(endpoints, collection, databaseStatus, redisStatus),
      endpoints,
      collection,
      data: dataStatus,
      services: {
        database: databaseStatus,
        redis: redisStatus,
      },
    };
  }

  /**
   * Check status of each endpoint
   */
  private async checkEndpoints(): Promise<EndpointStatus[]> {
    const endpoints: EndpointStatus[] = [
      {
        path: '/api/v1/market/ohlcv',
        method: 'GET',
        status: 'ok',
        lastChecked: new Date().toISOString(),
      },
      {
        path: '/api/v1/market/symbols',
        method: 'GET',
        status: 'ok',
        lastChecked: new Date().toISOString(),
      },
      {
        path: '/api/v1/market/ticker',
        method: 'GET',
        status: 'ok',
        lastChecked: new Date().toISOString(),
      },
      {
        path: '/api/v1/market/health',
        method: 'GET',
        status: 'ok',
        lastChecked: new Date().toISOString(),
      },
      {
        path: '/api/v1/backfill',
        method: 'POST',
        status: 'ok',
        lastChecked: new Date().toISOString(),
      },
    ];

    // Test each endpoint's dependencies
    for (const endpoint of endpoints) {
      try {
        const startTime = Date.now();

        if (endpoint.path === '/api/v1/market/ohlcv' || endpoint.path === '/api/v1/market/symbols') {
          // Test database connection
          await this.drizzle.db.execute(sql`SELECT 1`);
        }

        if (endpoint.path === '/api/v1/market/ticker' || endpoint.path === '/api/v1/market/health') {
          // Test Redis connection
          await this.redis.ping();
        }

        endpoint.responseTime = Date.now() - startTime;
        endpoint.status = 'ok';
      } catch (error) {
        endpoint.status = 'error';
        endpoint.error = error.message;
      }
    }

    return endpoints;
  }

  /**
   * Check data status in Redis
   */
  private async checkDataStatus(): Promise<{
    exchanges: ExchangeDataStatus[];
    markets: MarketDataStatus[];
  }> {
    const exchanges: ExchangeDataStatus[] = [];
    const markets: MarketDataStatus[] = [];

    for (const symbolConfig of SYMBOLS) {
      const { base, markets: marketConfigs } = symbolConfig;

      for (const [quote, marketConfig] of Object.entries(marketConfigs)) {
        // Check aggregated market data
        const aggregatedKey = `candle:${base}:${quote}:aggregated`;
        const aggregatedData = await this.redis.hgetall(aggregatedKey);

        markets.push({
          base,
          quote,
          hasData: !!aggregatedData && !!aggregatedData.c,
          lastUpdate: aggregatedData.t ? parseInt(aggregatedData.t) : undefined,
          price: aggregatedData.c ? parseFloat(aggregatedData.c) : undefined,
          sourceCount: aggregatedData.sources ? parseInt(aggregatedData.sources) : undefined,
        });

        // Check individual exchange data
        for (const exchangeConfig of marketConfig.exchanges) {
          const { name, pair } = exchangeConfig;
          const exchangeKey = `candle:${pair}:${name}`;
          const exchangeData = await this.redis.hgetall(exchangeKey);

          exchanges.push({
            exchange: name,
            pair,
            hasData: !!exchangeData && !!exchangeData.c,
            lastUpdate: exchangeData.t ? parseInt(exchangeData.t) : undefined,
            price: exchangeData.c ? parseFloat(exchangeData.c) : undefined,
          });
        }
      }
    }

    return { exchanges, markets };
  }

  /**
   * Check database status
   */
  private async checkDatabaseStatus(): Promise<{ status: string; error?: string }> {
    try {
      await this.drizzle.db.execute(sql`SELECT 1`);
      return { status: 'connected' };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Check Redis status
   */
  private async checkRedisStatus(): Promise<{ status: string; error?: string }> {
    try {
      await this.redis.ping();
      return { status: 'connected' };
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Determine overall status
   */
  private determineOverallStatus(
    endpoints: EndpointStatus[],
    collection: CollectionStatus,
    databaseStatus: { status: string },
    redisStatus: { status: string },
  ): 'healthy' | 'degraded' | 'unhealthy' {
    const hasEndpointErrors = endpoints.some((e) => e.status === 'error');
    const hasServiceErrors = databaseStatus.status === 'error' || redisStatus.status === 'error';
    const collectionStale = collection.lastCollectionTime
      ? Date.now() - collection.lastCollectionTime > 10000 // 10 seconds
      : true;

    if (hasServiceErrors || (hasEndpointErrors && collectionStale)) {
      return 'unhealthy';
    }

    if (hasEndpointErrors || collectionStale || collection.totalErrors > 10) {
      return 'degraded';
    }

    return 'healthy';
  }
}

