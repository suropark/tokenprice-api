# Token Price Oracle - Simplified Implementation Plan

## 🎯 프로젝트 목표

**핵심 요구사항**:
- CEX: Binance, Upbit 2개
- 확장 가능: 100 토큰 처리 가능
- TypeScript only
- Docker 배포
- **빠른 MVP**: 1주일 내 동작하는 시스템

---

## 📦 기술 스택 (Minimal)

```json
{
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/config": "^3.1.1",
    "@nestjs/schedule": "^4.0.0",
    "@nestjs/throttler": "^5.0.0",

    "ioredis": "^5.3.2",
    "@prisma/client": "^5.7.0",

    "axios": "^1.6.2",
    "zod": "^3.22.4",

    "winston": "^3.11.0",
    "prom-client": "^15.1.0"
  },
  "devDependencies": {
    "prisma": "^5.7.0",
    "@nestjs/testing": "^10.0.0",
    "@types/jest": "^29.5.2",
    "jest": "^29.7.0",
    "supertest": "^6.3.3",
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0"
  }
}
```

**제거된 것들**:
- ❌ ccxt (무거움, 직접 API 호출)
- ❌ typeorm (Prisma가 더 간단)
- ❌ big.js (초기엔 불필요)
- ❌ testcontainers (초기엔 불필요)

---

## 🗓️ 구현 계획: 7일 MVP

### Day 1: 프로젝트 기초

#### Task 1.1: NestJS 프로젝트 초기화 (1시간)
```bash
npx @nestjs/cli new tokenprice-api
cd tokenprice-api
npm install ioredis @nestjs/config @nestjs/schedule axios zod winston
npm install -D @types/node typescript
```

**파일 구조**:
```
src/
  config/
    configuration.ts
    redis.config.ts
  app.module.ts
  main.ts
```

**테스트**: `npm run start:dev` 실행 확인

---

#### Task 1.2: 환경 설정 (30분)

**.env**:
```bash
NODE_ENV=development
PORT=3000

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Database
DATABASE_URL="postgresql://user:password@localhost:5432/oracle?schema=public"

# Symbols (comma-separated)
SYMBOLS=BTC/USDT,ETH/USDT

# API Keys (optional for public endpoints)
BINANCE_API_KEY=
UPBIT_API_KEY=
```

**configuration.ts**:
```typescript
import { z } from 'zod';

const ConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']),
  port: z.coerce.number().default(3000),
  redis: z.object({
    host: z.string(),
    port: z.coerce.number(),
  }),
  databaseUrl: z.string(),
  symbols: z.string().transform(s => s.split(',')),
});

export const configuration = () => {
  const config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: process.env.PORT,
    redis: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
    },
    databaseUrl: process.env.DATABASE_URL,
    symbols: process.env.SYMBOLS,
  };

  return ConfigSchema.parse(config);
};
```

**테스트**: 환경 변수 누락 시 에러 발생 확인

---

#### Task 1.3: Docker Compose (30분)

**docker-compose.yml**:
```yaml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes

  timescaledb:
    image: timescale/timescaledb:latest-pg15
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: oracle_user
      POSTGRES_PASSWORD: oracle_pass
      POSTGRES_DB: oracle_db
    volumes:
      - timescale-data:/var/lib/postgresql/data

volumes:
  redis-data:
  timescale-data:
```

**테스트**:
```bash
docker-compose up -d
docker-compose ps  # 모두 Up 확인
redis-cli PING     # PONG
```

---

### Day 2: Exchange Clients

#### Task 2.1: Binance Client (1시간)

**src/clients/binance.client.ts**:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export interface PriceData {
  price: number;
  volume: number;
  timestamp: number;
}

@Injectable()
export class BinanceClient {
  private readonly logger = new Logger(BinanceClient.name);
  private readonly axios: AxiosInstance;

  constructor() {
    this.axios = axios.create({
      baseURL: 'https://api.binance.com',
      timeout: 5000,
    });
  }

  /**
   * BTC/USDT → BTCUSDT
   */
  private normalizeSymbol(symbol: string): string {
    return symbol.replace('/', '');
  }

  /**
   * Get current price for a symbol
   */
  async getPrice(symbol: string): Promise<PriceData | null> {
    try {
      const normalized = this.normalizeSymbol(symbol);
      const { data } = await this.axios.get('/api/v3/ticker/24hr', {
        params: { symbol: normalized },
      });

      return {
        price: parseFloat(data.lastPrice),
        volume: parseFloat(data.volume),
        timestamp: data.closeTime,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch price for ${symbol}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get prices for multiple symbols
   */
  async getPrices(symbols: string[]): Promise<Map<string, PriceData>> {
    const results = new Map<string, PriceData>();

    // 병렬 요청
    const promises = symbols.map(async (symbol) => {
      const data = await this.getPrice(symbol);
      if (data) results.set(symbol, data);
    });

    await Promise.all(promises);
    return results;
  }
}
```

**테스트**:
```typescript
// src/clients/binance.client.spec.ts
describe('BinanceClient', () => {
  let client: BinanceClient;

  beforeEach(() => {
    client = new BinanceClient();
  });

  it('should fetch BTC/USDT price', async () => {
    const price = await client.getPrice('BTC/USDT');

    expect(price).toBeDefined();
    expect(price.price).toBeGreaterThan(0);
    expect(price.volume).toBeGreaterThan(0);
  });

  it('should return null for invalid symbol', async () => {
    const price = await client.getPrice('INVALID/USDT');
    expect(price).toBeNull();
  });

  it('should fetch multiple symbols', async () => {
    const prices = await client.getPrices(['BTC/USDT', 'ETH/USDT']);

    expect(prices.size).toBe(2);
    expect(prices.get('BTC/USDT')).toBeDefined();
    expect(prices.get('ETH/USDT')).toBeDefined();
  });
});
```

---

#### Task 2.2: Upbit Client (1시간)

**src/clients/upbit.client.ts**:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { PriceData } from './binance.client';

@Injectable()
export class UpbitClient {
  private readonly logger = new Logger(UpbitClient.name);
  private readonly axios: AxiosInstance;

  constructor() {
    this.axios = axios.create({
      baseURL: 'https://api.upbit.com',
      timeout: 5000,
    });
  }

  /**
   * BTC/USDT → KRW-BTC (Upbit uses KRW pairs)
   */
  private normalizeSymbol(symbol: string): string {
    const [base] = symbol.split('/');
    return `KRW-${base}`;
  }

  /**
   * Get current price for a symbol
   */
  async getPrice(symbol: string): Promise<PriceData | null> {
    try {
      const market = this.normalizeSymbol(symbol);
      const { data } = await this.axios.get('/v1/ticker', {
        params: { markets: market },
      });

      if (!data || data.length === 0) {
        return null;
      }

      const ticker = data[0];

      return {
        price: ticker.trade_price,
        volume: ticker.acc_trade_volume_24h,
        timestamp: ticker.timestamp,
      };
    } catch (error) {
      this.logger.error(`Failed to fetch price for ${symbol}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get prices for multiple symbols
   */
  async getPrices(symbols: string[]): Promise<Map<string, PriceData>> {
    const results = new Map<string, PriceData>();

    // Upbit supports batch request
    const markets = symbols.map(s => this.normalizeSymbol(s)).join(',');

    try {
      const { data } = await this.axios.get('/v1/ticker', {
        params: { markets },
      });

      data.forEach((ticker: any, index: number) => {
        const symbol = symbols[index];
        results.set(symbol, {
          price: ticker.trade_price,
          volume: ticker.acc_trade_volume_24h,
          timestamp: ticker.timestamp,
        });
      });
    } catch (error) {
      this.logger.error(`Failed to fetch batch prices: ${error.message}`);
    }

    return results;
  }
}
```

**테스트**: Binance와 동일한 구조

---

#### Task 2.3: Exchange Module (30분)

**src/clients/exchange.module.ts**:
```typescript
import { Module } from '@nestjs/common';
import { BinanceClient } from './binance.client';
import { UpbitClient } from './upbit.client';

@Module({
  providers: [BinanceClient, UpbitClient],
  exports: [BinanceClient, UpbitClient],
})
export class ExchangeModule {}
```

---

### Day 3: Prisma & Database

#### Task 3.1: Prisma 설정 (1시간)

```bash
npm install @prisma/client
npm install -D prisma

npx prisma init
```

**prisma/schema.prisma**:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Ohlcv1m {
  time        DateTime @db.Timestamptz(6)
  symbol      String   @db.Text
  open        Decimal  @db.Decimal(20, 8)
  high        Decimal  @db.Decimal(20, 8)
  low         Decimal  @db.Decimal(20, 8)
  close       Decimal  @db.Decimal(20, 8)
  volume      Decimal  @db.Decimal(30, 8)
  quoteVolume Decimal  @map("quote_volume") @db.Decimal(30, 8)
  sourceCount Int      @default(0) @map("source_count")

  @@id([time, symbol])
  @@index([symbol, time])
  @@map("ohlcv_1m")
}
```

**migrations/001_init.sql**:
```sql
-- Enable TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Create table (Prisma will create basic table)
-- We just need to convert to hypertable

SELECT create_hypertable('ohlcv_1m', 'time', if_not_exists => TRUE);

-- Compression
ALTER TABLE ohlcv_1m SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol'
);

SELECT add_compression_policy('ohlcv_1m', INTERVAL '7 days');

-- Retention (optional)
SELECT add_retention_policy('ohlcv_1m', INTERVAL '2 years');
```

**실행**:
```bash
npx prisma migrate dev --name init
psql $DATABASE_URL -f migrations/001_init.sql
npx prisma generate
```

**테스트**:
```typescript
// src/database/database.service.spec.ts
describe('Database', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should connect to database', async () => {
    await expect(prisma.$queryRaw`SELECT 1`).resolves.toBeDefined();
  });

  it('should insert OHLCV data', async () => {
    const data = await prisma.ohlcv1m.create({
      data: {
        time: new Date(),
        symbol: 'BTC/USDT',
        open: 42000,
        high: 42100,
        low: 41900,
        close: 42050,
        volume: 100,
        quoteVolume: 4205000,
        sourceCount: 2,
      },
    });

    expect(data).toBeDefined();
  });
});
```

---

### Day 4: Price Collection Service

#### Task 4.1: Aggregation Service (2시간)

**src/services/aggregation.service.ts**:
```typescript
import { Injectable } from '@nestjs/common';
import { PriceData } from '../clients/binance.client';

export interface AggregatedPrice {
  price: number;
  volume: number;
  sourceCount: number;
  algorithm: 'median' | 'vwap';
}

@Injectable()
export class AggregationService {
  /**
   * Calculate median price
   */
  calculateMedian(prices: number[]): number {
    if (prices.length === 0) throw new Error('No prices to aggregate');

    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * Calculate Volume-Weighted Average Price
   */
  calculateVWAP(priceData: PriceData[]): number {
    let totalVolume = 0;
    let weightedSum = 0;

    for (const { price, volume } of priceData) {
      totalVolume += volume;
      weightedSum += price * volume;
    }

    if (totalVolume === 0) {
      // Fallback to median if no volume data
      return this.calculateMedian(priceData.map(d => d.price));
    }

    return weightedSum / totalVolume;
  }

  /**
   * Aggregate multiple price sources
   */
  aggregate(priceData: PriceData[]): AggregatedPrice {
    if (priceData.length === 0) {
      throw new Error('No price data to aggregate');
    }

    // Check if we have volume data
    const hasVolume = priceData.some(d => d.volume > 0);

    const price = hasVolume
      ? this.calculateVWAP(priceData)
      : this.calculateMedian(priceData.map(d => d.price));

    const totalVolume = priceData.reduce((sum, d) => sum + d.volume, 0);

    return {
      price,
      volume: totalVolume,
      sourceCount: priceData.length,
      algorithm: hasVolume ? 'vwap' : 'median',
    };
  }
}
```

**테스트**:
```typescript
describe('AggregationService', () => {
  let service: AggregationService;

  beforeEach(() => {
    service = new AggregationService();
  });

  describe('calculateMedian', () => {
    it('should calculate median for odd number of prices', () => {
      expect(service.calculateMedian([100, 150, 200])).toBe(150);
    });

    it('should calculate median for even number of prices', () => {
      expect(service.calculateMedian([100, 200])).toBe(150);
    });
  });

  describe('calculateVWAP', () => {
    it('should calculate VWAP correctly', () => {
      const data: PriceData[] = [
        { price: 100, volume: 1000, timestamp: Date.now() },
        { price: 200, volume: 4000, timestamp: Date.now() },
      ];

      // VWAP = (100*1000 + 200*4000) / (1000 + 4000) = 180
      expect(service.calculateVWAP(data)).toBeCloseTo(180, 2);
    });

    it('should fallback to median when no volume', () => {
      const data: PriceData[] = [
        { price: 100, volume: 0, timestamp: Date.now() },
        { price: 200, volume: 0, timestamp: Date.now() },
      ];

      expect(service.calculateVWAP(data)).toBe(150);
    });
  });

  describe('aggregate', () => {
    it('should use VWAP when volume available', () => {
      const data: PriceData[] = [
        { price: 100, volume: 1000, timestamp: Date.now() },
        { price: 200, volume: 4000, timestamp: Date.now() },
      ];

      const result = service.aggregate(data);

      expect(result.algorithm).toBe('vwap');
      expect(result.price).toBeCloseTo(180, 2);
      expect(result.sourceCount).toBe(2);
    });

    it('should use median when no volume', () => {
      const data: PriceData[] = [
        { price: 100, volume: 0, timestamp: Date.now() },
        { price: 200, volume: 0, timestamp: Date.now() },
      ];

      const result = service.aggregate(data);

      expect(result.algorithm).toBe('median');
      expect(result.price).toBe(150);
    });
  });
});
```

---

#### Task 4.2: Collector Service (2시간)

**src/services/collector.service.ts**:
```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { BinanceClient } from '../clients/binance.client';
import { UpbitClient } from '../clients/upbit.client';
import { AggregationService } from './aggregation.service';

@Injectable()
export class CollectorService implements OnModuleInit {
  private readonly logger = new Logger(CollectorService.name);
  private symbols: string[];

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly binance: BinanceClient,
    private readonly upbit: UpbitClient,
    private readonly aggregator: AggregationService,
  ) {
    this.symbols = this.config.get<string[]>('symbols', []);
  }

  onModuleInit() {
    this.logger.log(`Initialized with symbols: ${this.symbols.join(', ')}`);
  }

  @Cron(CronExpression.EVERY_SECOND)
  async collectPrices() {
    for (const symbol of this.symbols) {
      try {
        await this.collectSymbol(symbol);
      } catch (error) {
        this.logger.error(`Failed to collect ${symbol}: ${error.message}`);
      }
    }
  }

  private async collectSymbol(symbol: string) {
    // 1. Fetch from exchanges
    const [binanceData, upbitData] = await Promise.all([
      this.binance.getPrice(symbol),
      this.upbit.getPrice(symbol),
    ]);

    // 2. Filter valid data
    const validData = [binanceData, upbitData].filter(d => d !== null);

    if (validData.length === 0) {
      this.logger.warn(`No valid prices for ${symbol}`);
      return;
    }

    // 3. Aggregate
    const aggregated = this.aggregator.aggregate(validData);

    // 4. Update Redis
    await this.updateRedis(symbol, aggregated.price);

    this.logger.debug(
      `Updated ${symbol}: ${aggregated.price} (${aggregated.algorithm}, ${aggregated.sourceCount} sources)`
    );
  }

  private async updateRedis(symbol: string, price: number) {
    const key = `candle:${symbol}`;

    // Check if candle exists
    const exists = await this.redis.exists(key);

    if (!exists) {
      // Create new candle
      await this.redis.hset(key, {
        o: price,
        h: price,
        l: price,
        c: price,
        t: Date.now(),
      });
    } else {
      // Update existing candle
      const [high, low] = await this.redis.hmget(key, 'h', 'l');

      await this.redis.hset(key, {
        h: Math.max(parseFloat(high), price),
        l: Math.min(parseFloat(low), price),
        c: price,
      });
    }
  }
}
```

**테스트**:
```typescript
describe('CollectorService', () => {
  let service: CollectorService;
  let redis: Redis;
  let binance: BinanceClient;
  let upbit: UpbitClient;

  beforeEach(() => {
    redis = {
      exists: jest.fn(),
      hset: jest.fn(),
      hmget: jest.fn(),
    } as any;

    binance = {
      getPrice: jest.fn().mockResolvedValue({
        price: 42000,
        volume: 100,
        timestamp: Date.now(),
      }),
    } as any;

    upbit = {
      getPrice: jest.fn().mockResolvedValue({
        price: 42050,
        volume: 50,
        timestamp: Date.now(),
      }),
    } as any;

    service = new CollectorService(
      redis,
      { get: () => ['BTC/USDT'] } as any,
      binance,
      upbit,
      new AggregationService(),
    );
  });

  it('should collect prices and update Redis', async () => {
    jest.spyOn(redis, 'exists').mockResolvedValue(0);

    await service['collectSymbol']('BTC/USDT');

    expect(binance.getPrice).toHaveBeenCalledWith('BTC/USDT');
    expect(upbit.getPrice).toHaveBeenCalledWith('BTC/USDT');
    expect(redis.hset).toHaveBeenCalled();
  });

  it('should update existing candle', async () => {
    jest.spyOn(redis, 'exists').mockResolvedValue(1);
    jest.spyOn(redis, 'hmget').mockResolvedValue(['42100', '41900']);

    await service['updateRedis']('BTC/USDT', 42050);

    expect(redis.hset).toHaveBeenCalledWith(
      'candle:BTC/USDT',
      expect.objectContaining({
        h: 42100, // max(42100, 42050)
        l: 41900, // min(41900, 42050)
        c: 42050,
      })
    );
  });
});
```

---

### Day 5: Storage Service

#### Task 5.1: Storage Service (2시간)

**src/services/storage.service.ts**:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly prisma: PrismaClient,
  ) {}

  @Cron('5 * * * * *') // Every minute at :05 seconds
  async flushToDatabase() {
    try {
      const keys = await this.redis.keys('candle:*');

      if (keys.length === 0) {
        this.logger.debug('No candles to flush');
        return;
      }

      this.logger.log(`Flushing ${keys.length} candles to database`);

      for (const key of keys) {
        await this.flushCandle(key);
      }

      this.logger.log(`✅ Flushed ${keys.length} candles`);
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
  }
}
```

**테스트**:
```typescript
describe('StorageService', () => {
  let service: StorageService;
  let redis: Redis;
  let prisma: PrismaClient;

  beforeEach(() => {
    redis = {
      keys: jest.fn(),
      hgetall: jest.fn(),
      del: jest.fn(),
    } as any;

    prisma = {
      ohlcv1m: {
        upsert: jest.fn(),
      },
    } as any;

    service = new StorageService(redis, prisma);
  });

  it('should flush candles to database', async () => {
    jest.spyOn(redis, 'keys').mockResolvedValue(['candle:BTC/USDT']);
    jest.spyOn(redis, 'hgetall').mockResolvedValue({
      o: '42000',
      h: '42100',
      l: '41900',
      c: '42050',
      t: '1704110400000',
    });

    await service.flushToDatabase();

    expect(prisma.ohlcv1m.upsert).toHaveBeenCalled();
    expect(redis.del).toHaveBeenCalledWith('candle:BTC/USDT');
  });

  it('should skip empty candles', async () => {
    jest.spyOn(redis, 'keys').mockResolvedValue(['candle:BTC/USDT']);
    jest.spyOn(redis, 'hgetall').mockResolvedValue({});

    await service.flushToDatabase();

    expect(prisma.ohlcv1m.upsert).not.toHaveBeenCalled();
  });
});
```

---

### Day 6: API Layer

#### Task 6.1: Market Controller (2시간)

**src/api/dto/ohlcv-query.dto.ts**:
```typescript
import { IsString, IsNotEmpty, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class OhlcvQueryDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(0)
  from: number;

  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(0)
  to: number;
}
```

**src/api/market.controller.ts**:
```typescript
import { Controller, Get, Query, ValidationPipe } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { OhlcvQueryDto } from './dto/ohlcv-query.dto';

@Controller('api/v1/market')
export class MarketController {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly prisma: PrismaClient,
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

    // 2. Get current candle from Redis (if within range)
    const now = Date.now() / 1000;
    let result = historical.map(h => ({
      time: Math.floor(h.time.getTime() / 1000),
      open: parseFloat(h.open.toString()),
      high: parseFloat(h.high.toString()),
      low: parseFloat(h.low.toString()),
      close: parseFloat(h.close.toString()),
      volume: parseFloat(h.volume.toString()),
    }));

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
    const symbols = await this.prisma.ohlcv1m.findMany({
      distinct: ['symbol'],
      select: { symbol: true },
    });

    return {
      symbols: symbols.map(s => s.symbol),
      count: symbols.length,
    };
  }
}
```

**E2E 테스트**:
```typescript
// test/market.e2e-spec.ts
describe('Market API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/market/ohlcv should return data', () => {
    return request(app.getHttpServer())
      .get('/api/v1/market/ohlcv')
      .query({
        symbol: 'BTC/USDT',
        from: Math.floor(Date.now() / 1000) - 3600,
        to: Math.floor(Date.now() / 1000),
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toBeDefined();
        expect(Array.isArray(res.body.data)).toBe(true);
      });
  });

  it('GET /api/v1/market/symbols should return symbol list', () => {
    return request(app.getHttpServer())
      .get('/api/v1/market/symbols')
      .expect(200)
      .expect(res => {
        expect(res.body.symbols).toBeDefined();
        expect(Array.isArray(res.body.symbols)).toBe(true);
      });
  });
});
```

---

### Day 7: Docker & Testing

#### Task 7.1: Dockerfile (1시간)

**Dockerfile**:
```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/main"]
```

**.dockerignore**:
```
node_modules
dist
.env
.git
*.md
test
```

**docker-compose.prod.yml**:
```yaml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_HOST=redis
      - DATABASE_URL=postgresql://oracle_user:oracle_pass@timescaledb:5432/oracle_db
      - SYMBOLS=BTC/USDT,ETH/USDT
    depends_on:
      - redis
      - timescaledb
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis-data:/data

  timescaledb:
    image: timescale/timescaledb:latest-pg15
    environment:
      POSTGRES_USER: oracle_user
      POSTGRES_PASSWORD: oracle_pass
      POSTGRES_DB: oracle_db
    restart: unless-stopped
    volumes:
      - timescale-data:/var/lib/postgresql/data

volumes:
  redis-data:
  timescale-data:
```

**테스트**:
```bash
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
curl http://localhost:3000/api/v1/market/symbols
```

---

#### Task 7.2: 통합 테스트 & Coverage (2시간)

```bash
npm run test          # Unit tests
npm run test:e2e      # E2E tests
npm run test:cov      # Coverage report
```

**Coverage 목표**:
- Overall: 70%+ (실용적 목표)
- Critical services: 80%+
  - AggregationService
  - CollectorService
  - StorageService

---

## 📊 최종 구조

```
src/
├── clients/
│   ├── binance.client.ts        # Binance API
│   ├── upbit.client.ts          # Upbit API
│   └── exchange.module.ts
├── services/
│   ├── aggregation.service.ts   # VWAP/Median
│   ├── collector.service.ts     # Price collection
│   └── storage.service.ts       # DB persistence
├── api/
│   ├── dto/
│   │   └── ohlcv-query.dto.ts
│   └── market.controller.ts     # REST API
├── config/
│   ├── configuration.ts
│   └── redis.config.ts
├── app.module.ts
└── main.ts

prisma/
  ├── schema.prisma
  └── migrations/

test/
  ├── clients/
  ├── services/
  └── api/

docker-compose.yml
docker-compose.prod.yml
Dockerfile
```

---

## 🚀 배포 및 실행

### 개발 환경
```bash
# 1. Infrastructure
docker-compose up -d

# 2. DB setup
npx prisma migrate dev
psql $DATABASE_URL -f migrations/001_init.sql

# 3. Run
npm run start:dev
```

### 프로덕션
```bash
docker-compose -f docker-compose.prod.yml up -d
```

---

## 📈 확장 계획 (필요시)

### Week 2: 확장성

1. **WebSocket 지원** (토큰 50개 이상)
```typescript
class WebSocketManager {
  // Binance WebSocket streams
  // Upbit WebSocket streams
}
```

2. **Rate Limiting**
```typescript
@UseGuards(ThrottlerGuard)
@Throttle(100, 60)
```

3. **Outlier Detection**
```typescript
removeOutliers(prices: number[]): number[] {
  // IQR method
}
```

4. **Metrics**
```typescript
@Injectable()
class MetricsService {
  // Prometheus metrics
}
```

5. **Multiple Instances** (필요시)
```typescript
// 간단한 Redis lock
const lock = await redis.set('lock:collect', 'true', 'NX', 'EX', 5);
if (!lock) return;
```

---

## ✅ 체크리스트

### Day 1
- [ ] NestJS 초기화
- [ ] 환경 설정
- [ ] Docker Compose

### Day 2
- [ ] Binance Client + Tests
- [ ] Upbit Client + Tests
- [ ] Exchange Module

### Day 3
- [ ] Prisma 설정
- [ ] Database 마이그레이션
- [ ] TimescaleDB 설정

### Day 4
- [ ] Aggregation Service + Tests
- [ ] Collector Service + Tests

### Day 5
- [ ] Storage Service + Tests
- [ ] 통합 테스트

### Day 6
- [ ] Market Controller
- [ ] E2E Tests

### Day 7
- [ ] Dockerfile
- [ ] 프로덕션 배포
- [ ] Coverage 확인

---

## 🎯 성공 기준

1. ✅ 2개 거래소에서 가격 수집
2. ✅ Redis에 실시간 캔들 저장
3. ✅ 1분마다 DB로 플러시
4. ✅ REST API 동작
5. ✅ Docker로 배포 가능
6. ✅ 70%+ 테스트 커버리지
7. ✅ 100 토큰 확장 가능한 구조

**MVP 완료: 7일!** 🚀
