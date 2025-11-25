# Token Price Oracle - Implementation Plan

## Overview

This document provides a **step-by-step implementation plan** in chronological order, broken down into small, manageable tasks. Each task includes acceptance criteria and **mandatory test requirements**.

**Key Principles**:
- ✅ Test-first approach: Write tests before or alongside implementation
- ✅ Minimum 80% code coverage (90%+ for critical modules)
- ✅ Each task should be completable in 1-4 hours
- ✅ Commit frequently with clear messages
- ✅ Run tests before moving to next task

---

## Phase 1: Project Foundation (Days 1-2)

### Task 1.1: Initialize NestJS Project
**Duration**: 30 minutes

**Steps**:
1. Create new NestJS project: `npx @nestjs/cli new tokenprice-api`
2. Choose `npm` as package manager
3. Update `package.json` with required dependencies
4. Configure TypeScript (`tsconfig.json`)
5. Set up ESLint and Prettier

**Dependencies to add**:
```json
{
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/config": "^3.1.1",
    "@nestjs/schedule": "^4.0.0",
    "@nestjs/typeorm": "^10.0.1",
    "@nestjs-modules/ioredis": "^2.0.0",
    "ioredis": "^5.3.2",
    "typeorm": "^0.3.17",
    "pg": "^8.11.3",
    "big.js": "^6.2.1",
    "axios": "^1.6.2",
    "zod": "^3.22.4",
    "prom-client": "^15.1.0",
    "winston": "^3.11.0"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.0.0",
    "@types/jest": "^29.5.2",
    "jest": "^29.5.0",
    "supertest": "^6.3.3",
    "testcontainers": "^10.4.0"
  }
}
```

**Tests**: N/A (setup task)

**Acceptance Criteria**:
- [x] `npm run start:dev` works
- [x] `npm run test` runs Jest successfully
- [x] `npm run lint` passes

**Commit**: `chore: initialize NestJS project with dependencies`

---

### Task 1.2: Configure Environment Variables
**Duration**: 30 minutes

**Steps**:
1. Create `.env.example` file (from DESIGN.md Section 10.1)
2. Create `.env` file (gitignored)
3. Install `@nestjs/config`
4. Create `src/config/configuration.ts`
5. Set up `ConfigModule` in `app.module.ts`

**Files to create**:
- `.env.example`
- `.env`
- `src/config/configuration.ts`
- `src/config/validation.schema.ts`

**Tests**:
```typescript
// src/config/configuration.spec.ts
describe('Configuration', () => {
  it('should load environment variables', () => {
    const config = configuration();
    expect(config.port).toBeDefined();
    expect(config.redis.host).toBeDefined();
  });

  it('should validate required variables', () => {
    delete process.env.REDIS_HOST;
    expect(() => validationSchema.parse(process.env)).toThrow();
  });
});
```

**Acceptance Criteria**:
- [x] All environment variables are validated on startup
- [x] Missing required variables throw error
- [x] Tests pass: `npm run test -- configuration.spec.ts`

**Commit**: `feat(config): add environment configuration with validation`

---

### Task 1.3: Set Up Docker Compose for Local Development
**Duration**: 45 minutes

**Steps**:
1. Create `docker-compose.yml` (from DESIGN.md Section 10.2)
2. Create `scripts/init-db.sql` for TimescaleDB setup
3. Test local services startup

**Files to create**:
- `docker-compose.yml`
- `scripts/init-db.sql`

**Tests**:
```bash
# Manual verification
docker-compose up -d
docker-compose ps  # All services should be "Up"
redis-cli PING  # Should return "PONG"
psql -h localhost -U oracle_user -d oracle_db -c "SELECT 1"
```

**Acceptance Criteria**:
- [x] Redis starts on port 6379
- [x] TimescaleDB starts on port 5432
- [x] Can connect to both services

**Commit**: `chore: add docker-compose for local development`

---

## Phase 2: Common Modules (Days 2-3)

### Task 2.1: Implement Logger Service
**Duration**: 1 hour

**Steps**:
1. Create `src/common/logger/logger.service.ts`
2. Configure Winston with JSON format
3. Add context and metadata support
4. Integrate with NestJS built-in logger

**Files to create**:
- `src/common/logger/logger.service.ts`
- `src/common/logger/logger.module.ts`

**Tests**:
```typescript
// src/common/logger/logger.service.spec.ts
describe('LoggerService', () => {
  let service: LoggerService;

  beforeEach(() => {
    service = new LoggerService();
  });

  it('should log info messages', () => {
    const spy = jest.spyOn(service['logger'], 'info');
    service.log('test message', 'TestContext');
    expect(spy).toHaveBeenCalledWith('test message', expect.objectContaining({ context: 'TestContext' }));
  });

  it('should log error with stack trace', () => {
    const spy = jest.spyOn(service['logger'], 'error');
    service.error('error message', 'stack trace', 'ErrorContext');
    expect(spy).toHaveBeenCalled();
  });
});
```

**Acceptance Criteria**:
- [x] Logger outputs JSON in production, human-readable in dev
- [x] All log levels work (debug, info, warn, error)
- [x] Tests pass with >90% coverage

**Commit**: `feat(common): implement structured logger with Winston`

---

### Task 2.2: Implement Metrics Service
**Duration**: 1.5 hours

**Steps**:
1. Create `src/common/metrics/metrics.service.ts`
2. Define Prometheus metrics (Counter, Histogram, Gauge)
3. Create `/metrics` endpoint
4. Add metrics for core operations

**Files to create**:
- `src/common/metrics/metrics.service.ts`
- `src/common/metrics/metrics.controller.ts`
- `src/common/metrics/metrics.module.ts`

**Metrics to implement**:
- `oracle_price_updates_total` (Counter)
- `oracle_ingestion_duration_seconds` (Histogram)
- `oracle_flush_duration_seconds` (Histogram)
- `oracle_exchange_health` (Gauge)
- `oracle_redis_connected` (Gauge)

**Tests**:
```typescript
// src/common/metrics/metrics.service.spec.ts
describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService();
    register.clear(); // Clear metrics between tests
  });

  it('should increment price update counter', () => {
    service.recordPriceUpdate('BTC/USDT', { algorithm: 'vwap', sourceCount: 3 });
    const metrics = service.getMetrics();
    expect(metrics).toContain('oracle_price_updates_total');
  });

  it('should record ingestion duration', () => {
    service.recordIngestionDuration(150);
    const metrics = service.getMetrics();
    expect(metrics).toContain('oracle_ingestion_duration_seconds');
  });
});
```

**E2E Test**:
```typescript
// test/metrics.e2e-spec.ts
describe('Metrics Endpoint (e2e)', () => {
  it('GET /metrics should return Prometheus format', () => {
    return request(app.getHttpServer())
      .get('/metrics')
      .expect(200)
      .expect('Content-Type', /text\/plain/);
  });
});
```

**Acceptance Criteria**:
- [x] `/metrics` endpoint returns Prometheus-compatible output
- [x] All defined metrics are registered
- [x] Tests pass with >85% coverage

**Commit**: `feat(common): add Prometheus metrics service`

---

### Task 2.3: Set Up Redis Connection
**Duration**: 1 hour

**Steps**:
1. Install `@nestjs-modules/ioredis` and `ioredis`
2. Create `src/config/redis.config.ts`
3. Register RedisModule in AppModule
4. Add Redis health check

**Files to create**:
- `src/config/redis.config.ts`

**Tests**:
```typescript
// test/redis.integration-spec.ts
describe('Redis Integration', () => {
  let redis: Redis;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [RedisModule.forRoot(redisConfig)],
    }).compile();
    redis = module.get('default_IORedisModuleConnectionToken');
  });

  it('should connect to Redis', async () => {
    const result = await redis.ping();
    expect(result).toBe('PONG');
  });

  it('should set and get values', async () => {
    await redis.set('test:key', 'value', 'EX', 60);
    const result = await redis.get('test:key');
    expect(result).toBe('value');
  });

  afterAll(async () => {
    await redis.quit();
  });
});
```

**Acceptance Criteria**:
- [x] Application connects to Redis on startup
- [x] Connection pool is configured
- [x] Tests pass

**Commit**: `feat(config): add Redis connection module`

---

### Task 2.4: Set Up TypeORM with TimescaleDB
**Duration**: 2 hours

**Steps**:
1. Create `src/config/database.config.ts`
2. Register TypeORM module
3. Create initial migration for `ohlcv_1m` table
4. Add TimescaleDB extension and hypertable
5. Create continuous aggregate views

**Files to create**:
- `src/config/database.config.ts`
- `src/storage/entities/ohlcv.entity.ts`
- `migrations/001-create-ohlcv-table.ts`
- `migrations/002-create-continuous-aggregates.ts`

**Entity**:
```typescript
// src/storage/entities/ohlcv.entity.ts
@Entity('ohlcv_1m')
export class OhlcvEntity {
  @PrimaryColumn({ type: 'timestamptz' })
  time: Date;

  @PrimaryColumn({ type: 'text' })
  symbol: string;

  @Column({ type: 'numeric', precision: 20, scale: 8 })
  open: number;

  @Column({ type: 'numeric', precision: 20, scale: 8 })
  high: number;

  @Column({ type: 'numeric', precision: 20, scale: 8 })
  low: number;

  @Column({ type: 'numeric', precision: 20, scale: 8 })
  close: number;

  @Column({ type: 'numeric', precision: 30, scale: 8, default: 0 })
  volume: number;

  @Column({ type: 'numeric', precision: 30, scale: 8, default: 0, name: 'quote_volume' })
  quoteVolume: number;

  @Column({ type: 'int', default: 0, name: 'source_count' })
  sourceCount: number;

  @Column({ type: 'text', array: true, default: '{}' })
  sources: string[];
}
```

**Tests**:
```typescript
// test/database.integration-spec.ts
describe('Database Integration', () => {
  let dataSource: DataSource;
  let repo: Repository<OhlcvEntity>;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [TypeOrmModule.forRoot(dbConfig), TypeOrmModule.forFeature([OhlcvEntity])],
    }).compile();
    dataSource = module.get(DataSource);
    repo = module.get(getRepositoryToken(OhlcvEntity));
  });

  it('should connect to database', async () => {
    expect(dataSource.isInitialized).toBe(true);
  });

  it('should insert and retrieve OHLCV data', async () => {
    const entity = repo.create({
      time: new Date(),
      symbol: 'BTC/USDT',
      open: 42000,
      high: 42100,
      low: 41900,
      close: 42050,
      volume: 100,
      quoteVolume: 4205000,
      sourceCount: 3,
      sources: ['binance', 'upbit'],
    });

    await repo.save(entity);

    const found = await repo.findOne({
      where: { symbol: 'BTC/USDT' },
    });

    expect(found).toBeDefined();
    expect(found.open).toBe(42000);
  });
});
```

**Acceptance Criteria**:
- [x] Migrations create all required tables and views
- [x] TimescaleDB hypertable is created
- [x] Continuous aggregates are set up
- [x] Tests pass

**Commit**: `feat(database): set up TypeORM with TimescaleDB`

---

## Phase 3: Leader Election (Day 4)

### Task 3.1: Implement Leader Service
**Duration**: 2 hours

**Steps**:
1. Create `src/common/leader/leader.service.ts`
2. Implement lock acquisition with SET NX
3. Add heartbeat mechanism
4. Implement fencing tokens
5. Add graceful shutdown

**Files to create**:
- `src/common/leader/leader.service.ts`
- `src/common/leader/leader.module.ts`

**Implementation**: See DESIGN.md Section 6.1

**Tests**:
```typescript
// src/common/leader/leader.service.spec.ts
describe('LeaderService', () => {
  let service: LeaderService;
  let redis: Redis;

  beforeEach(async () => {
    redis = new Redis(); // Use test Redis
    service = new LeaderService(redis);
    await redis.flushdb();
  });

  afterEach(async () => {
    await redis.quit();
  });

  it('should acquire leadership on first attempt', async () => {
    await service.start();
    const isLeader = await service.isLeader();
    expect(isLeader).toBe(true);
  });

  it('should not acquire leadership if already taken', async () => {
    const service1 = new LeaderService(redis);
    const service2 = new LeaderService(redis);

    await service1.start();
    await service2.start();

    expect(await service1.isLeader()).toBe(true);
    expect(await service2.isLeader()).toBe(false);
  });

  it('should renew leadership before expiration', async () => {
    await service.start();
    await new Promise(resolve => setTimeout(resolve, 15000)); // Wait 15s
    const isLeader = await service.isLeader();
    expect(isLeader).toBe(true); // Still leader due to heartbeat
  });

  it('should release lock on shutdown', async () => {
    await service.start();
    await service.onModuleDestroy();

    const lock = await redis.get('oracle:leader:election');
    expect(lock).toBeNull();
  });
});
```

**Acceptance Criteria**:
- [x] Only one instance can be leader at a time
- [x] Heartbeat renews lock before expiration
- [x] Graceful shutdown releases lock
- [x] Tests pass with >90% coverage

**Commit**: `feat(leader): implement Redis-based leader election`

---

### Task 3.2: Create @LeaderOnly Decorator
**Duration**: 1 hour

**Steps**:
1. Create `src/common/decorators/leader-only.decorator.ts`
2. Implement NestJS interceptor
3. Integrate with LeaderService

**Files to create**:
- `src/common/decorators/leader-only.decorator.ts`

**Implementation**: See DESIGN.md Section 6.1

**Tests**:
```typescript
// src/common/decorators/leader-only.spec.ts
describe('LeaderOnlyInterceptor', () => {
  let interceptor: LeaderOnlyInterceptor;
  let leaderService: LeaderService;

  beforeEach(() => {
    leaderService = {
      isLeader: jest.fn(),
    } as any;
    interceptor = new LeaderOnlyInterceptor(new Reflector(), leaderService);
  });

  it('should execute method if instance is leader', async () => {
    jest.spyOn(leaderService, 'isLeader').mockResolvedValue(true);

    const mockHandler = {
      handle: jest.fn().mockReturnValue(of('result')),
    };

    const context = createMockExecutionContext(true); // has @LeaderOnly

    const result = await firstValueFrom(
      await interceptor.intercept(context, mockHandler)
    );

    expect(mockHandler.handle).toHaveBeenCalled();
    expect(result).toBe('result');
  });

  it('should skip execution if not leader', async () => {
    jest.spyOn(leaderService, 'isLeader').mockResolvedValue(false);

    const mockHandler = {
      handle: jest.fn(),
    };

    const context = createMockExecutionContext(true);

    await interceptor.intercept(context, mockHandler);

    expect(mockHandler.handle).not.toHaveBeenCalled();
  });
});
```

**Acceptance Criteria**:
- [x] Methods with @LeaderOnly only execute on leader instance
- [x] Non-leader instances silently skip execution
- [x] Tests pass with >90% coverage

**Commit**: `feat(leader): add @LeaderOnly decorator and interceptor`

---

## Phase 4: Exchange Integration (Days 5-6)

### Task 4.1: Implement Circuit Breaker
**Duration**: 2 hours

**Steps**:
1. Create `src/ingestion/exchanges/circuit-breaker.ts`
2. Implement state machine (CLOSED → OPEN → HALF_OPEN)
3. Add failure tracking with time window

**Files to create**:
- `src/ingestion/exchanges/circuit-breaker.ts`

**Implementation**: See DESIGN.md Section 9.2

**Tests**:
```typescript
// src/ingestion/exchanges/circuit-breaker.spec.ts
describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 5000,
      monitoringPeriod: 10000,
    });
  });

  it('should start in CLOSED state', () => {
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it('should open after threshold failures', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fn).catch(() => {});
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it('should reject calls when OPEN', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fn).catch(() => {});
    }

    await expect(breaker.execute(fn)).rejects.toThrow('Circuit breaker is OPEN');
  });

  it('should transition to HALF_OPEN after timeout', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await breaker.execute(fn).catch(() => {});
    }

    expect(breaker.getState()).toBe(CircuitState.OPEN);

    await new Promise(resolve => setTimeout(resolve, 5100));

    const successFn = jest.fn().mockResolvedValue('ok');
    await breaker.execute(successFn);

    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });
});
```

**Acceptance Criteria**:
- [x] Circuit breaker opens after threshold failures
- [x] Rejects calls when OPEN
- [x] Auto-resets after timeout
- [x] Tests pass with >95% coverage

**Commit**: `feat(exchanges): implement circuit breaker pattern`

---

### Task 4.2: Create Base Exchange Service
**Duration**: 1 hour

**Steps**:
1. Create `src/ingestion/exchanges/base-exchange.service.ts`
2. Define `PriceData` interface
3. Add circuit breaker integration
4. Add error logging

**Files to create**:
- `src/ingestion/exchanges/base-exchange.service.ts`
- `src/ingestion/exchanges/interfaces/price-data.interface.ts`

**Tests**:
```typescript
// src/ingestion/exchanges/base-exchange.service.spec.ts
class TestExchangeService extends BaseExchangeService {
  async fetchPrice(symbol: string): Promise<PriceData> {
    return {
      exchange: 'test',
      symbol,
      price: 42000,
      volume: 100,
      quoteVolume: 4200000,
      timestamp: Date.now(),
    };
  }
}

describe('BaseExchangeService', () => {
  let service: TestExchangeService;

  beforeEach(() => {
    service = new TestExchangeService('Test');
  });

  it('should fetch price successfully', async () => {
    const price = await service.fetchPriceWithCircuitBreaker('BTC/USDT');
    expect(price).toBeDefined();
    expect(price.price).toBe(42000);
  });

  it('should return null when circuit breaker opens', async () => {
    jest.spyOn(service, 'fetchPrice').mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 10; i++) {
      await service.fetchPriceWithCircuitBreaker('BTC/USDT');
    }

    const result = await service.fetchPriceWithCircuitBreaker('BTC/USDT');
    expect(result).toBeNull();
  });
});
```

**Acceptance Criteria**:
- [x] Base class provides circuit breaker integration
- [x] Errors are logged with context
- [x] Tests pass

**Commit**: `feat(exchanges): create base exchange service`

---

### Task 4.3: Implement Binance Service
**Duration**: 2 hours

**Steps**:
1. Create `src/ingestion/exchanges/binance.service.ts`
2. Implement `/api/v3/ticker/24hr` endpoint call
3. Add symbol normalization (BTC/USDT → BTCUSDT)
4. Add timeout and retry logic
5. Add historical data fetching for backfill

**Files to create**:
- `src/ingestion/exchanges/binance.service.ts`

**Implementation**: See DESIGN.md Section 6.2

**Tests**:
```typescript
// src/ingestion/exchanges/binance.service.spec.ts
describe('BinanceService', () => {
  let service: BinanceService;
  let httpService: HttpService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        BinanceService,
        {
          provide: HttpService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<BinanceService>(BinanceService);
    httpService = module.get<HttpService>(HttpService);
  });

  it('should fetch BTC/USDT price', async () => {
    jest.spyOn(httpService, 'get').mockResolvedValue({
      data: {
        symbol: 'BTCUSDT',
        lastPrice: '42000.50',
        volume: '1234.56',
        quoteVolume: '51842100.00',
        closeTime: 1704110400000,
      },
    } as any);

    const result = await service.fetchPrice('BTC/USDT');

    expect(result.exchange).toBe('binance');
    expect(result.symbol).toBe('BTC/USDT');
    expect(result.price).toBe(42000.50);
  });

  it('should normalize symbol format', () => {
    expect(service['normalizeSymbol']('BTC/USDT')).toBe('BTCUSDT');
    expect(service['normalizeSymbol']('ETH/USDT')).toBe('ETHUSDT');
  });

  it('should throw on API error', async () => {
    jest.spyOn(httpService, 'get').mockRejectedValue(new Error('Network error'));

    await expect(service.fetchPrice('BTC/USDT')).rejects.toThrow('Network error');
  });
});
```

**Acceptance Criteria**:
- [x] Successfully fetches price from Binance API
- [x] Symbol normalization works correctly
- [x] Errors are handled gracefully
- [x] Tests pass with >85% coverage

**Commit**: `feat(exchanges): implement Binance exchange service`

---

### Task 4.4: Implement Upbit Service
**Duration**: 1.5 hours

**Steps**:
1. Create `src/ingestion/exchanges/upbit.service.ts`
2. Implement `/v1/ticker` endpoint call
3. Add KRW/USDT conversion if needed
4. Add symbol normalization

**Files to create**:
- `src/ingestion/exchanges/upbit.service.ts`

**Tests**: Similar to Binance tests

**Acceptance Criteria**:
- [x] Successfully fetches price from Upbit API
- [x] Tests pass with >85% coverage

**Commit**: `feat(exchanges): implement Upbit exchange service`

---

### Task 4.5: Create Exchange Module
**Duration**: 30 minutes

**Steps**:
1. Create `src/ingestion/exchanges/exchange.module.ts`
2. Register all exchange services
3. Export for use in IngestionModule

**Files to create**:
- `src/ingestion/exchanges/exchange.module.ts`

**Tests**: N/A (module registration)

**Commit**: `feat(exchanges): create exchange module`

---

## Phase 5: Aggregation Logic (Day 7)

### Task 5.1: Implement Outlier Detection
**Duration**: 2 hours

**Steps**:
1. Create `src/ingestion/aggregation.service.ts`
2. Implement IQR (Interquartile Range) method
3. Add variance calculation
4. Add logging for removed outliers

**Files to create**:
- `src/ingestion/aggregation.service.ts`

**Implementation**: See DESIGN.md Section 6.3

**Tests**:
```typescript
// src/ingestion/aggregation.service.spec.ts
describe('AggregationService - Outlier Detection', () => {
  let service: AggregationService;

  beforeEach(() => {
    service = new AggregationService();
  });

  it('should remove outliers using IQR', () => {
    const prices: PriceData[] = [
      { exchange: 'a', symbol: 'BTC/USDT', price: 100, volume: 10, quoteVolume: 1000, timestamp: Date.now() },
      { exchange: 'b', symbol: 'BTC/USDT', price: 101, volume: 10, quoteVolume: 1010, timestamp: Date.now() },
      { exchange: 'c', symbol: 'BTC/USDT', price: 102, volume: 10, quoteVolume: 1020, timestamp: Date.now() },
      { exchange: 'd', symbol: 'BTC/USDT', price: 103, volume: 10, quoteVolume: 1030, timestamp: Date.now() },
      { exchange: 'e', symbol: 'BTC/USDT', price: 500, volume: 10, quoteVolume: 5000, timestamp: Date.now() }, // Outlier
    ];

    const result = service.aggregate(prices);

    expect(result).toBeDefined();
    expect(result.sourceCount).toBe(4); // Outlier removed
    expect(result.outliersRemoved).toBe(1);
    expect(result.price).toBeGreaterThan(100);
    expect(result.price).toBeLessThan(200); // Outlier 500 not included
  });

  it('should keep all prices if no outliers', () => {
    const prices: PriceData[] = [
      { exchange: 'a', symbol: 'BTC/USDT', price: 100, volume: 10, quoteVolume: 1000, timestamp: Date.now() },
      { exchange: 'b', symbol: 'BTC/USDT', price: 101, volume: 10, quoteVolume: 1010, timestamp: Date.now() },
      { exchange: 'c', symbol: 'BTC/USDT', price: 102, volume: 10, quoteVolume: 1020, timestamp: Date.now() },
    ];

    const result = service.aggregate(prices);

    expect(result.sourceCount).toBe(3);
    expect(result.outliersRemoved).toBe(0);
  });

  it('should handle edge case with < 4 prices', () => {
    const prices: PriceData[] = [
      { exchange: 'a', symbol: 'BTC/USDT', price: 100, volume: 10, quoteVolume: 1000, timestamp: Date.now() },
      { exchange: 'b', symbol: 'BTC/USDT', price: 101, volume: 10, quoteVolume: 1010, timestamp: Date.now() },
    ];

    const result = service.aggregate(prices);

    expect(result.sourceCount).toBe(2); // No outlier removal with < 4 samples
  });
});
```

**Acceptance Criteria**:
- [x] IQR method correctly identifies and removes outliers
- [x] Edge cases handled (< 4 prices, all outliers, etc.)
- [x] Tests pass with >95% coverage

**Commit**: `feat(aggregation): implement IQR outlier detection`

---

### Task 5.2: Implement VWAP Calculation
**Duration**: 1.5 hours

**Steps**:
1. Add VWAP method to AggregationService
2. Use big.js for precision math
3. Handle zero volume case

**Implementation**: See DESIGN.md Section 6.3

**Tests**:
```typescript
describe('AggregationService - VWAP', () => {
  let service: AggregationService;

  beforeEach(() => {
    service = new AggregationService();
  });

  it('should calculate VWAP correctly', () => {
    const prices: PriceData[] = [
      { exchange: 'a', symbol: 'BTC/USDT', price: 100, volume: 10, quoteVolume: 1000, timestamp: Date.now() },
      { exchange: 'b', symbol: 'BTC/USDT', price: 200, volume: 20, quoteVolume: 4000, timestamp: Date.now() },
    ];

    const result = service.aggregate(prices);

    expect(result.algorithm).toBe('vwap');
    // VWAP = (100*1000 + 200*4000) / (1000 + 4000) = 180
    expect(result.price).toBeCloseTo(180, 2);
  });

  it('should handle equal volumes', () => {
    const prices: PriceData[] = [
      { exchange: 'a', symbol: 'BTC/USDT', price: 100, volume: 10, quoteVolume: 1000, timestamp: Date.now() },
      { exchange: 'b', symbol: 'BTC/USDT', price: 200, volume: 10, quoteVolume: 1000, timestamp: Date.now() },
    ];

    const result = service.aggregate(prices);

    expect(result.price).toBeCloseTo(150, 2); // Simple average when volumes equal
  });

  it('should give more weight to higher volume exchanges', () => {
    const prices: PriceData[] = [
      { exchange: 'a', symbol: 'BTC/USDT', price: 100, volume: 1, quoteVolume: 100, timestamp: Date.now() },
      { exchange: 'b', symbol: 'BTC/USDT', price: 200, volume: 99, quoteVolume: 19800, timestamp: Date.now() },
    ];

    const result = service.aggregate(prices);

    expect(result.price).toBeCloseTo(200, 0); // Should be very close to 200
  });
});
```

**Acceptance Criteria**:
- [x] VWAP calculation is mathematically correct
- [x] Uses high-precision math (big.js)
- [x] Tests pass with >95% coverage

**Commit**: `feat(aggregation): implement VWAP calculation`

---

### Task 5.3: Implement Median Fallback
**Duration**: 1 hour

**Steps**:
1. Add median calculation method
2. Fallback to median when volume is zero
3. Add algorithm field to result

**Tests**:
```typescript
describe('AggregationService - Median', () => {
  let service: AggregationService;

  beforeEach(() => {
    service = new AggregationService();
  });

  it('should fallback to median when no volume data', () => {
    const prices: PriceData[] = [
      { exchange: 'a', symbol: 'BTC/USDT', price: 100, volume: 0, quoteVolume: 0, timestamp: Date.now() },
      { exchange: 'b', symbol: 'BTC/USDT', price: 200, volume: 0, quoteVolume: 0, timestamp: Date.now() },
      { exchange: 'c', symbol: 'BTC/USDT', price: 150, volume: 0, quoteVolume: 0, timestamp: Date.now() },
    ];

    const result = service.aggregate(prices);

    expect(result.algorithm).toBe('median');
    expect(result.price).toBe(150);
  });

  it('should calculate median for even number of prices', () => {
    const prices: PriceData[] = [
      { exchange: 'a', symbol: 'BTC/USDT', price: 100, volume: 0, quoteVolume: 0, timestamp: Date.now() },
      { exchange: 'b', symbol: 'BTC/USDT', price: 200, volume: 0, quoteVolume: 0, timestamp: Date.now() },
    ];

    const result = service.aggregate(prices);

    expect(result.price).toBe(150); // (100 + 200) / 2
  });

  it('should calculate median for odd number of prices', () => {
    const prices: PriceData[] = [
      { exchange: 'a', symbol: 'BTC/USDT', price: 100, volume: 0, quoteVolume: 0, timestamp: Date.now() },
      { exchange: 'b', symbol: 'BTC/USDT', price: 150, volume: 0, quoteVolume: 0, timestamp: Date.now() },
      { exchange: 'c', symbol: 'BTC/USDT', price: 200, volume: 0, quoteVolume: 0, timestamp: Date.now() },
    ];

    const result = service.aggregate(prices);

    expect(result.price).toBe(150);
  });
});
```

**Acceptance Criteria**:
- [x] Median calculation is correct for odd/even counts
- [x] Fallback logic works when volume is zero
- [x] Tests pass with >95% coverage

**Commit**: `feat(aggregation): implement median fallback`

---

### Task 5.4: Add Quality Metrics
**Duration**: 1 hour

**Steps**:
1. Add variance calculation
2. Add price spread calculation
3. Log quality metrics

**Tests**:
```typescript
describe('AggregationService - Quality Metrics', () => {
  it('should calculate variance', () => {
    const prices: PriceData[] = [
      { exchange: 'a', symbol: 'BTC/USDT', price: 100, volume: 10, quoteVolume: 1000, timestamp: Date.now() },
      { exchange: 'b', symbol: 'BTC/USDT', price: 102, volume: 10, quoteVolume: 1020, timestamp: Date.now() },
      { exchange: 'c', symbol: 'BTC/USDT', price: 98, volume: 10, quoteVolume: 980, timestamp: Date.now() },
    ];

    const result = service.aggregate(prices);

    expect(result.variance).toBeGreaterThan(0);
    expect(result.variance).toBeLessThan(5); // Low variance for tight prices
  });

  it('should detect high variance', () => {
    const prices: PriceData[] = [
      { exchange: 'a', symbol: 'BTC/USDT', price: 100, volume: 10, quoteVolume: 1000, timestamp: Date.now() },
      { exchange: 'b', symbol: 'BTC/USDT', price: 150, volume: 10, quoteVolume: 1500, timestamp: Date.now() },
    ];

    const result = service.aggregate(prices);

    expect(result.variance).toBeGreaterThan(20); // High variance
  });
});
```

**Acceptance Criteria**:
- [x] Variance is calculated correctly
- [x] Quality metrics are logged
- [x] Tests pass

**Commit**: `feat(aggregation): add quality metrics calculation`

---

## Phase 6: Ingestion Service (Day 8)

### Task 6.1: Create Lua Script for Atomic Redis Updates
**Duration**: 1 hour

**Steps**:
1. Create `scripts/update_candle.lua`
2. Implement HGETALL + HMSET logic atomically
3. Test script in Redis CLI

**Files to create**:
- `scripts/update_candle.lua`

**Script**:
```lua
-- update_candle.lua
local key = KEYS[1]
local price = tonumber(ARGV[1])
local volume = tonumber(ARGV[2])
local quoteVolume = tonumber(ARGV[3])
local sourceCount = tonumber(ARGV[4])
local sources = ARGV[5]
local timestamp = tonumber(ARGV[6])

local exists = redis.call('EXISTS', key)

if exists == 0 then
  -- New candle
  redis.call('HMSET', key,
    'o', price,
    'h', price,
    'l', price,
    'c', price,
    'v', volume,
    'qv', quoteVolume,
    'sc', sourceCount,
    's', sources,
    't', timestamp
  )
else
  -- Update existing candle
  local high = redis.call('HGET', key, 'h')
  local low = redis.call('HGET', key, 'l')

  redis.call('HMSET', key,
    'h', math.max(tonumber(high), price),
    'l', math.min(tonumber(low), price),
    'c', price,
    'v', volume,
    'qv', quoteVolume,
    'sc', sourceCount,
    's', sources
  )
end

return 1
```

**Tests**:
```bash
# Test in Redis CLI
redis-cli --eval scripts/update_candle.lua oracle:candle:BTC/USDT:current , 42000 100 4200000 3 "binance,upbit" 1704110400000

# Verify
redis-cli HGETALL oracle:candle:BTC/USDT:current
```

**Acceptance Criteria**:
- [x] Script creates new candle if not exists
- [x] Script updates existing candle correctly
- [x] H/L values are maintained
- [x] Manual tests pass

**Commit**: `feat(ingestion): add Lua script for atomic Redis updates`

---

### Task 6.2: Implement Ingestion Service
**Duration**: 3 hours

**Steps**:
1. Create `src/ingestion/ingestion.service.ts`
2. Load Lua script on module init
3. Implement @Cron(EVERY_SECOND) job
4. Add @LeaderOnly decorator
5. Integrate with exchanges and aggregator
6. Update Redis using Lua script

**Files to create**:
- `src/ingestion/ingestion.service.ts`
- `src/ingestion/ingestion.module.ts`

**Implementation**: See DESIGN.md Section 6.4

**Tests**:
```typescript
// src/ingestion/ingestion.service.spec.ts
describe('IngestionService', () => {
  let service: IngestionService;
  let redis: Redis;
  let binance: BinanceService;
  let upbit: UpbitService;
  let aggregator: AggregationService;
  let leaderService: LeaderService;

  beforeEach(async () => {
    redis = {
      script: jest.fn().mockResolvedValue('sha123'),
      evalsha: jest.fn().mockResolvedValue(1),
    } as any;

    leaderService = {
      isLeader: jest.fn().mockResolvedValue(true),
    } as any;

    binance = {
      fetchPriceWithCircuitBreaker: jest.fn().mockResolvedValue({
        exchange: 'binance',
        symbol: 'BTC/USDT',
        price: 42000,
        volume: 100,
        quoteVolume: 4200000,
        timestamp: Date.now(),
      }),
    } as any;

    upbit = {
      fetchPriceWithCircuitBreaker: jest.fn().mockResolvedValue({
        exchange: 'upbit',
        symbol: 'BTC/USDT',
        price: 42050,
        volume: 50,
        quoteVolume: 2102500,
        timestamp: Date.now(),
      }),
    } as any;

    aggregator = {
      aggregate: jest.fn().mockReturnValue({
        symbol: 'BTC/USDT',
        price: 42025,
        volume: 150,
        quoteVolume: 6302500,
        sourceCount: 2,
        sources: ['binance', 'upbit'],
        algorithm: 'vwap',
        variance: 25,
        outliersRemoved: 0,
      }),
    } as any;

    service = new IngestionService(redis, leaderService, binance, upbit, aggregator, null, null);
    await service.onModuleInit();
  });

  it('should load Lua script on init', async () => {
    expect(redis.script).toHaveBeenCalledWith('LOAD', expect.any(String));
    expect(service['updateCandleSha']).toBe('sha123');
  });

  it('should collect prices and update Redis', async () => {
    await service.collectPrices();

    expect(binance.fetchPriceWithCircuitBreaker).toHaveBeenCalledWith('BTC/USDT');
    expect(upbit.fetchPriceWithCircuitBreaker).toHaveBeenCalledWith('BTC/USDT');
    expect(aggregator.aggregate).toHaveBeenCalled();
    expect(redis.evalsha).toHaveBeenCalledWith(
      'sha123',
      1,
      'oracle:candle:BTC/USDT:current',
      42025,
      150,
      6302500,
      2,
      'binance,upbit',
      expect.any(Number)
    );
  });

  it('should skip if not leader', async () => {
    jest.spyOn(leaderService, 'isLeader').mockResolvedValue(false);

    await service.collectPrices();

    expect(binance.fetchPriceWithCircuitBreaker).not.toHaveBeenCalled();
  });

  it('should handle exchange failures gracefully', async () => {
    jest.spyOn(binance, 'fetchPriceWithCircuitBreaker').mockResolvedValue(null);

    await service.collectPrices();

    // Should still aggregate with remaining exchange(s)
    expect(aggregator.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ exchange: 'upbit' })
      ])
    );
  });
});
```

**Acceptance Criteria**:
- [x] Service loads Lua script on startup
- [x] Collects prices every second (only leader)
- [x] Aggregates prices correctly
- [x] Updates Redis atomically
- [x] Handles exchange failures
- [x] Tests pass with >85% coverage

**Commit**: `feat(ingestion): implement price collection service`

---

### Task 6.3: Integration Test for Ingestion Pipeline
**Duration**: 2 hours

**Steps**:
1. Create full integration test with real Redis
2. Mock exchange APIs
3. Verify end-to-end flow

**Tests**:
```typescript
// test/ingestion.integration-spec.ts
describe('Ingestion Pipeline (Integration)', () => {
  let app: INestApplication;
  let redis: Redis;
  let ingestionService: IngestionService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(BinanceService)
      .useValue({
        fetchPriceWithCircuitBreaker: jest.fn().mockResolvedValue({
          exchange: 'binance',
          symbol: 'BTC/USDT',
          price: 42000,
          volume: 100,
          quoteVolume: 4200000,
          timestamp: Date.now(),
        }),
      })
      .compile();

    app = module.createNestApplication();
    await app.init();

    redis = app.get('default_IORedisModuleConnectionToken');
    ingestionService = app.get(IngestionService);

    await redis.flushdb();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should collect prices and store in Redis', async () => {
    await ingestionService.collectPrices();

    const candle = await redis.hgetall('oracle:candle:BTC/USDT:current');

    expect(candle).toBeDefined();
    expect(parseFloat(candle.o)).toBe(42000);
    expect(parseFloat(candle.c)).toBe(42000);
    expect(parseInt(candle.sc)).toBeGreaterThan(0);
  });

  it('should update existing candle', async () => {
    await ingestionService.collectPrices(); // First call

    // Change price for second call
    const binance = app.get(BinanceService);
    jest.spyOn(binance, 'fetchPriceWithCircuitBreaker').mockResolvedValue({
      exchange: 'binance',
      symbol: 'BTC/USDT',
      price: 42100,
      volume: 50,
      quoteVolume: 2105000,
      timestamp: Date.now(),
    });

    await ingestionService.collectPrices(); // Second call

    const candle = await redis.hgetall('oracle:candle:BTC/USDT:current');

    expect(parseFloat(candle.h)).toBe(42100); // High updated
    expect(parseFloat(candle.l)).toBe(42000); // Low remains
    expect(parseFloat(candle.c)).toBe(42100); // Close updated
  });
});
```

**Acceptance Criteria**:
- [x] End-to-end flow works with real Redis
- [x] Candles are created and updated correctly
- [x] Test passes

**Commit**: `test(ingestion): add integration test for pipeline`

---

## Phase 7: Storage/Flush Service (Day 9)

### Task 7.1: Implement Flush Service
**Duration**: 3 hours

**Steps**:
1. Create `src/storage/flush.service.ts`
2. Implement @Cron('5 * * * * *') job (every minute at :05)
3. Add distributed lock for flush operation
4. Fetch candles from Redis
5. Bulk insert to TimescaleDB with upsert
6. Mark candles as flushed (don't delete)
7. Update last flush timestamp

**Files to create**:
- `src/storage/flush.service.ts`

**Implementation**: See DESIGN.md Section 6.5

**Tests**:
```typescript
// src/storage/flush.service.spec.ts
describe('FlushService', () => {
  let service: FlushService;
  let redis: Redis;
  let repo: Repository<OhlcvEntity>;
  let leaderService: LeaderService;

  beforeEach(() => {
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      keys: jest.fn().mockResolvedValue([
        'oracle:candle:BTC/USDT:current',
        'oracle:candle:ETH/USDT:current',
      ]),
      pipeline: jest.fn().mockReturnValue({
        hgetall: jest.fn(),
        exec: jest.fn().mockResolvedValue([
          [null, { o: '42000', h: '42100', l: '41900', c: '42050', v: '100', qv: '4205000', sc: '2', s: 'binance,upbit' }],
          [null, { o: '2000', h: '2010', l: '1990', c: '2005', v: '50', qv: '100250', sc: '2', s: 'binance,upbit' }],
        ]),
        hset: jest.fn(),
        expire: jest.fn(),
      }),
      del: jest.fn().mockResolvedValue(1),
    } as any;

    repo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        insert: jest.fn().mockReturnThis(),
        into: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        orUpdate: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue(undefined),
      }),
    } as any;

    leaderService = {
      isLeader: jest.fn().mockResolvedValue(true),
    } as any;

    service = new FlushService(redis, repo, leaderService, null);
  });

  it('should acquire lock before flushing', async () => {
    await service.flushToDatabase();

    expect(redis.set).toHaveBeenCalledWith(
      'oracle:lock:flush',
      '1',
      'EX',
      10,
      'NX'
    );
  });

  it('should skip if lock not acquired', async () => {
    jest.spyOn(redis, 'set').mockResolvedValue(null);

    await service.flushToDatabase();

    expect(redis.keys).not.toHaveBeenCalled();
  });

  it('should fetch candles and save to DB', async () => {
    await service.flushToDatabase();

    expect(redis.keys).toHaveBeenCalledWith('oracle:candle:*:current');

    const queryBuilder = repo.createQueryBuilder();
    expect(queryBuilder.insert).toHaveBeenCalled();
    expect(queryBuilder.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          symbol: 'BTC/USDT',
          open: 42000,
          close: 42050,
        }),
      ])
    );
    expect(queryBuilder.execute).toHaveBeenCalled();
  });

  it('should mark candles as flushed', async () => {
    await service.flushToDatabase();

    const pipeline = redis.pipeline();
    expect(pipeline.hset).toHaveBeenCalled();
    expect(pipeline.expire).toHaveBeenCalledWith(expect.any(String), 3600);
  });
});
```

**Acceptance Criteria**:
- [x] Acquires distributed lock
- [x] Fetches all current candles from Redis
- [x] Bulk inserts to DB with upsert
- [x] Marks candles as flushed (keeps for 1 hour)
- [x] Tests pass with >85% coverage

**Commit**: `feat(storage): implement flush service`

---

### Task 7.2: Integration Test for Flush Service
**Duration**: 2 hours

**Steps**:
1. Create integration test with real Redis + DB
2. Seed Redis with candle data
3. Run flush service
4. Verify data in TimescaleDB

**Tests**:
```typescript
// test/flush.integration-spec.ts
describe('Flush Service (Integration)', () => {
  let app: INestApplication;
  let redis: Redis;
  let dataSource: DataSource;
  let flushService: FlushService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    redis = app.get('default_IORedisModuleConnectionToken');
    dataSource = app.get(DataSource);
    flushService = app.get(FlushService);

    await redis.flushdb();
    await dataSource.query('TRUNCATE TABLE ohlcv_1m');
  });

  afterAll(async () => {
    await app.close();
  });

  it('should flush Redis candles to database', async () => {
    // Seed Redis
    await redis.hmset('oracle:candle:BTC/USDT:current', {
      o: '42000',
      h: '42100',
      l: '41900',
      c: '42050',
      v: '100',
      qv: '4205000',
      sc: '2',
      s: 'binance,upbit',
      t: Date.now(),
    });

    // Run flush
    await flushService.flushToDatabase();

    // Verify DB
    const result = await dataSource.query(
      `SELECT * FROM ohlcv_1m WHERE symbol = 'BTC/USDT' ORDER BY time DESC LIMIT 1`
    );

    expect(result).toHaveLength(1);
    expect(parseFloat(result[0].open)).toBe(42000);
    expect(parseFloat(result[0].close)).toBe(42050);
  });

  it('should mark Redis candle as flushed', async () => {
    await redis.hmset('oracle:candle:ETH/USDT:current', {
      o: '2000',
      h: '2010',
      l: '1990',
      c: '2005',
      v: '50',
      qv: '100250',
      sc: '2',
      s: 'binance,upbit',
      t: Date.now(),
    });

    await flushService.flushToDatabase();

    const flushedAt = await redis.hget('oracle:candle:ETH/USDT:current', 'flushed_at');
    expect(flushedAt).toBeDefined();

    const ttl = await redis.ttl('oracle:candle:ETH/USDT:current');
    expect(ttl).toBeGreaterThan(3500); // ~1 hour
  });
});
```

**Acceptance Criteria**:
- [x] Data is correctly persisted to DB
- [x] Redis keys are marked as flushed
- [x] Test passes

**Commit**: `test(storage): add integration test for flush service`

---

## Phase 8: API Implementation (Days 10-11)

### Task 8.1: Create Health Check Endpoint
**Duration**: 1 hour

**Steps**:
1. Create `src/api/health.controller.ts`
2. Check Redis connection
3. Check DB connection
4. Check leader status
5. Return JSON response

**Files to create**:
- `src/api/health.controller.ts`

**Tests**:
```typescript
// test/health.e2e-spec.ts
describe('Health Endpoint (e2e)', () => {
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

  it('GET /api/v1/health should return 200', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect(res => {
        expect(res.body.status).toBe('ok');
        expect(res.body.services.redis).toBeDefined();
        expect(res.body.services.database).toBeDefined();
      });
  });
});
```

**Acceptance Criteria**:
- [x] Endpoint returns service health status
- [x] Test passes

**Commit**: `feat(api): add health check endpoint`

---

### Task 8.2: Implement OHLCV Query DTO with Validation
**Duration**: 1 hour

**Steps**:
1. Create `src/api/dto/ohlcv-query.dto.ts`
2. Add validation decorators
3. Add transformation pipes

**Files to create**:
- `src/api/dto/ohlcv-query.dto.ts`

**Implementation**:
```typescript
import { IsString, IsNotEmpty, IsIn, IsInt, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class OhlcvQueryDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsIn(['1m', '5m', '1h', '1d'])
  resolution: string;

  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(0)
  from: number;

  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(0)
  to: number;

  @Transform(({ value }) => (value ? parseInt(value) : 1000))
  @IsInt()
  @Min(1)
  limit?: number = 1000;
}
```

**Tests**:
```typescript
// src/api/dto/ohlcv-query.dto.spec.ts
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

describe('OhlcvQueryDto', () => {
  it('should validate correct input', async () => {
    const dto = plainToInstance(OhlcvQueryDto, {
      symbol: 'BTC/USDT',
      resolution: '1m',
      from: '1704110400',
      to: '1704114000',
    });

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('should reject invalid resolution', async () => {
    const dto = plainToInstance(OhlcvQueryDto, {
      symbol: 'BTC/USDT',
      resolution: '2m', // Invalid
      from: '1704110400',
      to: '1704114000',
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should transform string to number', async () => {
    const dto = plainToInstance(OhlcvQueryDto, {
      symbol: 'BTC/USDT',
      resolution: '1m',
      from: '1704110400', // String
      to: '1704114000',
    });

    expect(typeof dto.from).toBe('number');
    expect(dto.from).toBe(1704110400);
  });
});
```

**Acceptance Criteria**:
- [x] Validation works for all fields
- [x] Type transformation works
- [x] Tests pass

**Commit**: `feat(api): add OHLCV query DTO with validation`

---

### Task 8.3: Implement Market Controller
**Duration**: 3 hours

**Steps**:
1. Create `src/api/market.controller.ts`
2. Implement GET /api/v1/market/ohlcv
3. Query TimescaleDB for historical data
4. Query Redis for current candle
5. Merge and return results
6. Add rate limiting guard

**Files to create**:
- `src/api/market.controller.ts`
- `src/api/market.service.ts`

**Tests**:
```typescript
// test/market.e2e-spec.ts
describe('Market API (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    await app.init();

    redis = app.get('default_IORedisModuleConnectionToken');
    dataSource = app.get(DataSource);

    // Seed test data
    await dataSource.query(`
      INSERT INTO ohlcv_1m (time, symbol, open, high, low, close, volume, quote_volume, source_count)
      VALUES
        ('2024-01-01 00:00:00', 'BTC/USDT', 42000, 42100, 41900, 42050, 100, 4205000, 2),
        ('2024-01-01 00:01:00', 'BTC/USDT', 42050, 42150, 42000, 42100, 120, 5052000, 2)
    `);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/market/ohlcv should return historical data', () => {
    return request(app.getHttpServer())
      .get('/api/v1/market/ohlcv')
      .query({
        symbol: 'BTC/USDT',
        resolution: '1m',
        from: Math.floor(new Date('2024-01-01 00:00:00').getTime() / 1000),
        to: Math.floor(new Date('2024-01-01 00:05:00').getTime() / 1000),
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0].open).toBe(42000);
        expect(res.body.meta.count).toBe(2);
      });
  });

  it('should merge Redis current candle', async () => {
    await redis.hmset('oracle:candle:ETH/USDT:current', {
      o: '2000',
      h: '2010',
      l: '1990',
      c: '2005',
      v: '50',
      qv: '100250',
      t: Date.now(),
    });

    return request(app.getHttpServer())
      .get('/api/v1/market/ohlcv')
      .query({
        symbol: 'ETH/USDT',
        resolution: '1m',
        from: Math.floor(Date.now() / 1000) - 300,
        to: Math.floor(Date.now() / 1000),
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data.length).toBeGreaterThan(0);
        const last = res.body.data[res.body.data.length - 1];
        expect(last.close).toBe(2005);
      });
  });

  it('should enforce rate limiting', async () => {
    const requests = [];
    for (let i = 0; i < 101; i++) {
      requests.push(
        request(app.getHttpServer())
          .get('/api/v1/market/ohlcv')
          .query({
            symbol: 'BTC/USDT',
            resolution: '1m',
            from: 1704110400,
            to: 1704114000,
          })
      );
    }

    const responses = await Promise.all(requests);
    const rateLimited = responses.filter(r => r.status === 429);

    expect(rateLimited.length).toBeGreaterThan(0);
  });

  it('should return 400 for invalid input', () => {
    return request(app.getHttpServer())
      .get('/api/v1/market/ohlcv')
      .query({
        symbol: 'BTC/USDT',
        resolution: '2m', // Invalid
        from: 1704110400,
        to: 1704114000,
      })
      .expect(400);
  });
});
```

**Acceptance Criteria**:
- [x] Returns historical data from DB
- [x] Merges current candle from Redis
- [x] Rate limiting works
- [x] Input validation works
- [x] Tests pass

**Commit**: `feat(api): implement market OHLCV endpoint`

---

### Task 8.4: Add Rate Limiting Guard
**Duration**: 1.5 hours

**Steps**:
1. Create `src/api/guards/rate-limit.guard.ts`
2. Use Redis for distributed rate limiting
3. Apply to all API endpoints

**Files to create**:
- `src/api/guards/rate-limit.guard.ts`

**Implementation**: See DESIGN.md Section 7.2

**Tests**:
```typescript
// src/api/guards/rate-limit.guard.spec.ts
describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let redis: Redis;

  beforeEach(() => {
    redis = {
      incr: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn().mockResolvedValue(30),
    } as any;

    guard = new RateLimitGuard(redis);
  });

  it('should allow first request', async () => {
    jest.spyOn(redis, 'incr').mockResolvedValue(1);

    const context = createMockExecutionContext('192.168.1.1', '/api/v1/market/ohlcv');
    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(redis.expire).toHaveBeenCalled();
  });

  it('should block after limit exceeded', async () => {
    jest.spyOn(redis, 'incr').mockResolvedValue(101); // Over limit

    const context = createMockExecutionContext('192.168.1.1', '/api/v1/market/ohlcv');

    await expect(guard.canActivate(context)).rejects.toThrow(HttpException);
  });
});
```

**Acceptance Criteria**:
- [x] Rate limiting enforced per IP
- [x] Returns 429 with Retry-After header
- [x] Tests pass

**Commit**: `feat(api): add rate limiting guard`

---

## Phase 9: Backfill Service (Day 12)

### Task 9.1: Implement Gap Detection
**Duration**: 2 hours

**Steps**:
1. Create `src/storage/backfill.service.ts`
2. Query DB for missing minutes
3. Group consecutive gaps into ranges

**Files to create**:
- `src/storage/backfill.service.ts`

**Implementation**: See DESIGN.md Section 9.4

**Tests**:
```typescript
// src/storage/backfill.service.spec.ts
describe('BackfillService - Gap Detection', () => {
  let service: BackfillService;
  let repo: Repository<OhlcvEntity>;

  beforeEach(() => {
    repo = {
      query: jest.fn(),
    } as any;

    service = new BackfillService(null, repo, null);
  });

  it('should detect gaps in data', async () => {
    jest.spyOn(repo, 'query').mockResolvedValue([
      { missing_time: '2024-01-01 00:02:00' },
      { missing_time: '2024-01-01 00:03:00' },
      { missing_time: '2024-01-01 00:05:00' },
    ]);

    const gaps = await service['detectGaps']('BTC/USDT');

    expect(gaps).toHaveLength(2); // Two separate gaps
    expect(gaps[0]).toEqual({
      start: new Date('2024-01-01 00:02:00'),
      end: new Date('2024-01-01 00:03:00'),
    });
    expect(gaps[1]).toEqual({
      start: new Date('2024-01-01 00:05:00'),
      end: new Date('2024-01-01 00:05:00'),
    });
  });

  it('should return empty array when no gaps', async () => {
    jest.spyOn(repo, 'query').mockResolvedValue([]);

    const gaps = await service['detectGaps']('BTC/USDT');

    expect(gaps).toHaveLength(0);
  });
});
```

**Acceptance Criteria**:
- [x] Detects gaps in last 24 hours
- [x] Groups consecutive gaps
- [x] Tests pass

**Commit**: `feat(backfill): implement gap detection`

---

### Task 9.2: Implement Gap Filling
**Duration**: 2 hours

**Steps**:
1. Add historical data fetching to BinanceService
2. Fill gaps by fetching from exchange
3. Save to database

**Tests**:
```typescript
describe('BackfillService - Gap Filling', () => {
  let service: BackfillService;
  let repo: Repository<OhlcvEntity>;
  let binance: BinanceService;

  beforeEach(() => {
    repo = {
      save: jest.fn(),
    } as any;

    binance = {
      fetchHistoricalKlines: jest.fn().mockResolvedValue([
        {
          time: new Date('2024-01-01 00:02:00'),
          symbol: 'BTC/USDT',
          open: 42000,
          high: 42100,
          low: 41900,
          close: 42050,
          volume: 100,
          quoteVolume: 4205000,
          sourceCount: 1,
          sources: ['binance'],
        },
      ]),
    } as any;

    service = new BackfillService(null, repo, binance);
  });

  it('should fill gaps with historical data', async () => {
    await service['fillGap'](
      'BTC/USDT',
      new Date('2024-01-01 00:02:00'),
      new Date('2024-01-01 00:03:00')
    );

    expect(binance.fetchHistoricalKlines).toHaveBeenCalledWith(
      'BTC/USDT',
      '1m',
      expect.any(Number),
      expect.any(Number)
    );

    expect(repo.save).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ symbol: 'BTC/USDT' })
      ])
    );
  });
});
```

**Acceptance Criteria**:
- [x] Fetches historical data from exchange
- [x] Saves to database
- [x] Tests pass

**Commit**: `feat(backfill): implement gap filling`

---

### Task 9.3: Schedule Backfill Job
**Duration**: 1 hour

**Steps**:
1. Add @Cron decorator to run every 5 minutes
2. Add logging for backfill operations

**Tests**: Integration test

**Commit**: `feat(backfill): schedule backfill job`

---

## Phase 10: Final Integration & Testing (Days 13-14)

### Task 10.1: E2E Test for Complete Flow
**Duration**: 4 hours

**Steps**:
1. Create comprehensive E2E test
2. Test ingestion → flush → API flow
3. Test with multiple symbols

**Tests**:
```typescript
// test/complete-flow.e2e-spec.ts
describe('Complete Flow (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;
  let dataSource: DataSource;

  beforeAll(async () => {
    // Full app setup
  });

  it('should ingest, flush, and serve data', async () => {
    // 1. Wait for ingestion (1 second)
    await new Promise(resolve => setTimeout(resolve, 1100));

    // 2. Verify Redis has data
    const candle = await redis.hgetall('oracle:candle:BTC/USDT:current');
    expect(candle).toBeDefined();

    // 3. Trigger flush
    const flushService = app.get(FlushService);
    await flushService.flushToDatabase();

    // 4. Verify DB has data
    const result = await dataSource.query(
      `SELECT * FROM ohlcv_1m WHERE symbol = 'BTC/USDT' ORDER BY time DESC LIMIT 1`
    );
    expect(result).toHaveLength(1);

    // 5. Query API
    const response = await request(app.getHttpServer())
      .get('/api/v1/market/ohlcv')
      .query({
        symbol: 'BTC/USDT',
        resolution: '1m',
        from: Math.floor(Date.now() / 1000) - 300,
        to: Math.floor(Date.now() / 1000),
      });

    expect(response.status).toBe(200);
    expect(response.body.data.length).toBeGreaterThan(0);
  });
});
```

**Acceptance Criteria**:
- [x] Complete flow works end-to-end
- [x] Test passes

**Commit**: `test: add complete end-to-end flow test`

---

### Task 10.2: Load Testing
**Duration**: 3 hours

**Steps**:
1. Write load test for ingestion
2. Write load test for API
3. Measure performance metrics

**Tools**: k6 or Artillery

**Tests**:
```javascript
// test/load/api-load.js (k6)
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 100, // 100 virtual users
  duration: '1m',
};

export default function () {
  const res = http.get('http://localhost:3000/api/v1/market/ohlcv?symbol=BTC/USDT&resolution=1m&from=1704110400&to=1704114000');

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 100ms': (r) => r.timings.duration < 100,
  });
}
```

**Acceptance Criteria**:
- [x] API handles 100 concurrent users
- [x] P95 latency < 100ms
- [x] No errors under load

**Commit**: `test: add load tests`

---

### Task 10.3: Coverage Report & Fixes
**Duration**: 2 hours

**Steps**:
1. Run `npm run test:cov`
2. Identify modules below 80% coverage
3. Write additional tests to reach target

**Commands**:
```bash
npm run test:cov
open coverage/lcov-report/index.html
```

**Acceptance Criteria**:
- [x] Overall coverage > 80%
- [x] Critical modules > 90%

**Commit**: `test: improve coverage to meet requirements`

---

## Phase 11: Deployment Preparation (Day 15)

### Task 11.1: Create Docker Image
**Duration**: 1 hour

**Steps**:
1. Create optimized Dockerfile (multi-stage build)
2. Build and test image locally

**Tests**:
```bash
docker build -t oracle-api:latest .
docker run -p 3000:3000 oracle-api:latest
curl http://localhost:3000/api/v1/health
```

**Commit**: `chore: add production Dockerfile`

---

### Task 11.2: Create Kubernetes Manifests
**Duration**: 2 hours

**Steps**:
1. Create deployment.yaml
2. Create service.yaml
3. Create configmap.yaml
4. Create secrets (template)

**Files to create**:
- `k8s/deployment.yaml`
- `k8s/service.yaml`
- `k8s/configmap.yaml`
- `k8s/secrets.example.yaml`

**Commit**: `chore: add Kubernetes deployment manifests`

---

### Task 11.3: Set Up CI/CD Pipeline
**Duration**: 2 hours

**Steps**:
1. Create `.github/workflows/ci.yml`
2. Add lint, test, build steps
3. Add coverage check (fail if < 80%)

**Files to create**:
- `.github/workflows/ci.yml`

**Example**:
```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      redis:
        image: redis:7
        ports:
          - 6379:6379

      postgres:
        image: timescale/timescaledb:latest-pg15
        env:
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Run tests
        run: npm run test:cov

      - name: Check coverage
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 80%"
            exit 1
          fi

      - name: Build
        run: npm run build
```

**Acceptance Criteria**:
- [x] CI runs on every push
- [x] All tests must pass
- [x] Coverage must be > 80%

**Commit**: `ci: add GitHub Actions workflow`

---

### Task 11.4: Create README and Documentation
**Duration**: 2 hours

**Steps**:
1. Create comprehensive README.md
2. Add setup instructions
3. Add API documentation
4. Add troubleshooting guide

**Files to update**:
- `README.md`

**Commit**: `docs: add comprehensive README`

---

## Phase 12: Production Readiness (Day 16)

### Task 12.1: Security Audit
**Duration**: 2 hours

**Checklist**:
- [x] No hardcoded secrets
- [x] All environment variables documented
- [x] Rate limiting enabled
- [x] Input validation on all endpoints
- [x] SQL injection prevention (parameterized queries)
- [x] CORS configured
- [x] Helmet middleware added

**Commit**: `security: audit and fixes`

---

### Task 12.2: Performance Benchmarking
**Duration**: 2 hours

**Steps**:
1. Measure ingestion latency
2. Measure flush latency
3. Measure API latency
4. Document baseline metrics

**Commit**: `perf: add baseline performance metrics`

---

### Task 12.3: Monitoring Setup
**Duration**: 2 hours

**Steps**:
1. Create Grafana dashboard JSON
2. Document alert rules
3. Test metrics endpoint

**Files to create**:
- `monitoring/grafana-dashboard.json`
- `monitoring/alert-rules.yml`

**Commit**: `monitoring: add Grafana dashboard and alerts`

---

### Task 12.4: Final Review & Launch
**Duration**: 2 hours

**Checklist**:
- [x] All tests passing
- [x] Coverage > 80%
- [x] Documentation complete
- [x] CI/CD working
- [x] Docker image builds
- [x] K8s manifests validated
- [x] Environment variables documented
- [x] Monitoring configured

**Commit**: `chore: prepare for v1.0.0 release`

---

## Summary

### Total Estimated Time: ~16 days

### Phase Breakdown:
1. **Foundation** (2 days): Project setup, config, infrastructure
2. **Common Modules** (1 day): Logger, metrics, connections
3. **Leader Election** (1 day): Distributed locking
4. **Exchanges** (2 days): Circuit breaker, integrations
5. **Aggregation** (1 day): Outlier detection, VWAP, Median
6. **Ingestion** (1 day): Price collection service
7. **Storage** (1 day): Flush to database
8. **API** (2 days): REST endpoints, rate limiting
9. **Backfill** (1 day): Gap detection and filling
10. **Testing** (2 days): E2E, load testing, coverage
11. **Deployment** (1 day): Docker, K8s, CI/CD
12. **Production** (1 day): Security, monitoring, launch

### Test Coverage Requirements:
- **Minimum Overall**: 80%
- **Critical Modules**: 90%+
  - LeaderService
  - AggregationService
  - FlushService
  - CircuitBreaker

### Testing Pyramid:
- **Unit Tests**: ~150 tests (60%)
- **Integration Tests**: ~50 tests (20%)
- **E2E Tests**: ~20 tests (20%)

### Key Milestones:
- **Day 4**: Leader election working
- **Day 7**: Aggregation logic complete
- **Day 9**: Data persistence working
- **Day 11**: API functional
- **Day 14**: All tests passing
- **Day 16**: Production ready

---

**Remember**: Test-first approach. Write tests before or alongside implementation. Never skip testing!
