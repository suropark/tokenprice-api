# Token Price Oracle - Claude Development Guide

## Project Overview

This is a production-grade **cryptocurrency price aggregation system** that:
- Collects real-time price data from multiple exchanges (CEX/DEX)
- Aggregates prices using statistical algorithms (VWAP, Median) with outlier detection
- Stores time-series data efficiently using Redis (hot) + TimescaleDB (cold)
- Provides OHLCV data through REST API
- Uses distributed leader election to prevent duplicate data collection

**Tech Stack**: NestJS, TypeScript, Redis, PostgreSQL with TimescaleDB, TypeORM

---

## Architecture Quick Reference

### Core Modules

```
src/
├── common/                    # Shared utilities
│   ├── leader/               # Leader election service (Redis-based distributed lock)
│   ├── metrics/              # Prometheus metrics
│   └── logger/               # Structured logging (Winston)
├── ingestion/                # Price data collection (Leader-only)
│   ├── exchanges/            # Exchange integrations (Binance, Upbit, etc.)
│   ├── aggregation.service   # Outlier removal + VWAP/Median calculation
│   └── ingestion.service     # Main orchestrator (@Cron every 1s)
├── storage/                  # Data persistence
│   ├── flush.service         # Redis → DB batch writer (@Cron every 1m)
│   └── backfill.service      # Gap detection and historical data filling
├── api/                      # REST API endpoints
│   └── market.controller     # /api/v1/market/* endpoints
└── config/                   # Configuration management
```

### Data Flow

1. **Ingestion** (Leader only, every 1 second):
   - Fetch prices from multiple exchanges in parallel
   - Remove outliers using IQR method
   - Calculate aggregated price (VWAP or Median)
   - Update Redis current candle atomically (Lua script)

2. **Persistence** (Leader only, every 1 minute):
   - Read all current candles from Redis
   - Bulk insert into TimescaleDB (upsert on conflict)
   - Mark Redis keys as flushed (don't delete immediately)

3. **Querying** (All instances):
   - Fetch historical data from TimescaleDB
   - Fetch current candle from Redis
   - Merge and return to client

### Key Design Patterns

- **Leader Election**: Redis SET NX with TTL + fencing tokens
- **Circuit Breaker**: Per-exchange fault tolerance
- **Lua Scripts**: Atomic Redis operations
- **Continuous Aggregates**: TimescaleDB native feature for higher timeframes
- **Two-Phase Persistence**: Mark as flushed before deleting from Redis

---

## Critical Implementation Details

### 1. Leader Election

**Location**: `src/common/leader/leader.service.ts`

**Key Points**:
- Uses Redis `SET NX EX` for distributed lock
- TTL: 30 seconds, Heartbeat: 10 seconds
- Fencing tokens to prevent split-brain scenarios
- Graceful release on shutdown

**Usage**:
```typescript
@LeaderOnly()  // Decorator ensures only leader executes
async collectPrices() { ... }
```

### 2. Atomic Redis Updates

**Location**: `scripts/update_candle.lua`

**Why Lua?**: HGETALL + HMSET is not atomic. Race conditions can corrupt candles.

**Script Logic**:
```lua
-- If key doesn't exist: Create new candle with O=H=L=C=price
-- If key exists: Update H=max(H, price), L=min(L, price), C=price
```

**TypeORM Integration**:
```typescript
// Load script once on startup
this.updateCandleSha = await redis.script('LOAD', scriptContent);

// Execute atomically
await redis.evalsha(this.updateCandleSha, 1, key, price, volume, ...);
```

### 3. Outlier Detection

**Location**: `src/ingestion/aggregation.service.ts`

**Algorithm**: Interquartile Range (IQR)
- Calculate Q1 (25th percentile) and Q3 (75th percentile)
- IQR = Q3 - Q1
- Valid range: [Q1 - 1.5*IQR, Q3 + 1.5*IQR]
- Remove prices outside this range

**Why?**: A single malfunctioning exchange shouldn't skew the aggregated price.

### 4. VWAP vs Median

**VWAP (Volume-Weighted Average Price)**:
```typescript
VWAP = Σ(price * volume) / Σ(volume)
```
- Used when volume data is available
- Gives more weight to exchanges with higher liquidity
- More accurate for well-traded pairs

**Median**:
- Used when volume data is unavailable or zero
- Fallback method
- Resistant to outliers

### 5. Database Schema

**Primary Table**: `ohlcv_1m` (Hypertable)
- Stores 1-minute candles only
- Partitioned by time (1 week chunks)
- Compression after 7 days
- Retention policy: 2 years

**Higher Timeframes**: Continuous Aggregates (5m, 1h, 1d)
- Automatically generated from `ohlcv_1m`
- Materialized views refreshed every minute
- No need to manually calculate/store

**Indexes**:
```sql
-- Primary query pattern: symbol + time range
CREATE INDEX idx_ohlcv_1m_symbol_time ON ohlcv_1m (symbol, time DESC);
```

### 6. Two-Phase Persistence (Critical!)

**Problem**: Original design deleted Redis keys before DB write confirmation → data loss risk

**Solution**:
1. Read candle from Redis
2. Write to TimescaleDB (wait for confirmation)
3. Mark Redis key as flushed (HSET flushed_at)
4. Set TTL to 1 hour (keep as backup)

```typescript
// ❌ DANGEROUS - Don't do this
pipeline.hgetall(key);
pipeline.del(key);  // Deleted before DB write!

// ✅ SAFE
const data = await redis.hgetall(key);
await db.save(data);  // Wait for DB
await redis.hset(key, 'flushed_at', Date.now());
await redis.expire(key, 3600);  // Keep as backup
```

---

## Testing Requirements

### Coverage Targets
- **Overall**: 80%+ code coverage (enforced by CI)
- **Critical modules**: 90%+ coverage
  - Leader election
  - Aggregation logic
  - Flush service

### Test Structure

```
test/
├── unit/                     # Unit tests (Jest)
│   ├── aggregation.spec.ts   # Outlier removal, VWAP, Median
│   ├── leader.spec.ts        # Leader election logic
│   └── exchanges.spec.ts     # Individual exchange services
├── integration/              # Integration tests
│   ├── ingestion.spec.ts     # End-to-end ingestion flow
│   └── flush.spec.ts         # Redis → DB persistence
└── e2e/                      # API tests (Supertest)
    ├── market.e2e-spec.ts    # /api/v1/market/* endpoints
    └── health.e2e-spec.ts    # Health checks
```

### Critical Test Cases

1. **Aggregation Service**:
   - ✅ Outlier removal with IQR
   - ✅ VWAP calculation with volume weights
   - ✅ Median fallback when no volume
   - ✅ Empty input handling
   - ✅ Single source handling

2. **Leader Election**:
   - ✅ Lock acquisition
   - ✅ Heartbeat renewal
   - ✅ Lock expiration and re-election
   - ✅ Graceful shutdown releases lock
   - ✅ Fencing token validation

3. **Flush Service**:
   - ✅ Batch insert to DB
   - ✅ Upsert on conflict
   - ✅ Redis keys marked as flushed (not deleted)
   - ✅ Gap detection

4. **API**:
   - ✅ Historical data from DB
   - ✅ Current candle from Redis
   - ✅ Merge logic
   - ✅ Rate limiting (429 after 100 req/min)
   - ✅ Input validation

### Mocking Strategy

```typescript
// Mock Redis for unit tests
const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  hgetall: jest.fn(),
  hmset: jest.fn(),
  evalsha: jest.fn(),
};

// Use testcontainers for integration tests
import { GenericContainer } from 'testcontainers';

beforeAll(async () => {
  redisContainer = await new GenericContainer('redis:7')
    .withExposedPorts(6379)
    .start();
});
```

---

## Common Development Tasks

### Adding a New Exchange

1. **Create service class**:
```typescript
// src/ingestion/exchanges/kraken.service.ts
@Injectable()
export class KrakenService extends BaseExchangeService {
  constructor() {
    super('Kraken');
  }

  async fetchPrice(symbol: string): Promise<PriceData> {
    // Implementation
  }
}
```

2. **Register in module**:
```typescript
// src/ingestion/exchange.module.ts
@Module({
  providers: [BinanceService, UpbitService, KrakenService],
  exports: [BinanceService, UpbitService, KrakenService],
})
export class ExchangeModule {}
```

3. **Inject into ingestion service**:
```typescript
constructor(
  private readonly kraken: KrakenService,
  // ...
) {}

async collectPrices() {
  const rawPrices = await Promise.all([
    this.binance.fetchPriceWithCircuitBreaker(symbol),
    this.upbit.fetchPriceWithCircuitBreaker(symbol),
    this.kraken.fetchPriceWithCircuitBreaker(symbol),  // ← Add here
  ]);
}
```

4. **Write tests**:
```typescript
describe('KrakenService', () => {
  it('should fetch BTC/USDT price', async () => {
    const price = await krakenService.fetchPrice('BTC/USDT');
    expect(price.price).toBeGreaterThan(0);
  });
});
```

### Adding a New Timeframe

TimescaleDB handles this automatically via Continuous Aggregates:

```sql
-- Add 4-hour continuous aggregate
CREATE MATERIALIZED VIEW ohlcv_4h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('4 hours', time) AS bucket,
    symbol,
    FIRST(open, time) AS open,
    MAX(high) AS high,
    MIN(low) AS low,
    LAST(close, time) AS close,
    SUM(volume) AS volume,
    SUM(quote_volume) AS quote_volume
FROM ohlcv_1m
GROUP BY bucket, symbol
WITH NO DATA;

SELECT add_continuous_aggregate_policy('ohlcv_4h',
    start_offset => INTERVAL '12 hours',
    end_offset => INTERVAL '4 hours',
    schedule_interval => INTERVAL '4 hours'
);
```

Then update API to support `resolution=4h` query parameter.

### Running Locally

```bash
# 1. Start infrastructure
docker-compose up -d redis timescaledb

# 2. Install dependencies
npm install

# 3. Run migrations
npm run migration:run

# 4. Start dev server
npm run start:dev

# 5. Check health
curl http://localhost:3000/api/v1/health

# 6. Fetch OHLCV data
curl "http://localhost:3000/api/v1/market/ohlcv?symbol=BTC/USDT&resolution=1m&from=1704110400&to=1704114000"
```

---

## Troubleshooting Guide

### Issue: Multiple leaders detected

**Symptoms**: Duplicate data in Redis/DB, logs show multiple instances claiming leadership

**Causes**:
- Network partition between instances
- Redis connection issues
- TTL too short

**Solutions**:
1. Check Redis connectivity: `redis-cli PING`
2. Increase TTL: `LOCK_TTL = 30` (currently 30s)
3. Add fencing tokens (already implemented in DESIGN.md)
4. Monitor metrics: `oracle_leader_changes_total`

### Issue: Data gaps in TimescaleDB

**Symptoms**: Missing candles in query results

**Causes**:
- Leader instance crashed during flush
- Redis keys expired before flush
- DB write failure

**Solutions**:
1. Check `BackfillService` logs
2. Manually trigger backfill: `POST /admin/backfill?symbol=BTC/USDT&from=...&to=...`
3. Verify flush service is running: `GET /api/v1/health`

### Issue: API returns stale data

**Symptoms**: Current price is outdated

**Causes**:
- No leader elected (no ingestion)
- Exchange circuit breakers all OPEN
- Redis connection lost

**Solutions**:
1. Check leader status: `GET /api/v1/health` → `"leader": true`
2. Check exchange health metrics: `oracle_exchange_health{exchange="binance"}`
3. Check Redis: `redis-cli GET oracle:leader:election`

### Issue: High API latency

**Symptoms**: `/api/v1/market/ohlcv` response time > 1s

**Causes**:
- Large time range query
- Missing indexes
- TimescaleDB not compressed

**Solutions**:
1. Add pagination: `limit=1000`
2. Verify indexes: `EXPLAIN ANALYZE SELECT ...`
3. Check compression status: `SELECT * FROM timescaledb_information.chunks WHERE is_compressed = false`

---

## Performance Optimization Tips

### 1. Connection Pooling

```typescript
// config/database.config.ts
export default {
  type: 'postgres',
  poolSize: 20,  // Adjust based on instance count
  extra: {
    max: 20,
    min: 5,
    idleTimeoutMillis: 30000,
  },
};
```

### 2. Redis Pipelining

```typescript
// ✅ Good - Use pipeline for multiple operations
const pipeline = redis.pipeline();
keys.forEach(key => pipeline.hgetall(key));
const results = await pipeline.exec();

// ❌ Bad - Sequential round trips
for (const key of keys) {
  await redis.hgetall(key);  // Slow!
}
```

### 3. Bulk Database Inserts

```typescript
// ✅ Good - Bulk insert
await repo.save(entities, { chunk: 1000 });

// ❌ Bad - One by one
for (const entity of entities) {
  await repo.save(entity);
}
```

### 4. Query Optimization

```sql
-- ✅ Good - Use continuous aggregate for 5m+ timeframes
SELECT * FROM ohlcv_5m WHERE ...

-- ❌ Bad - Aggregate on-the-fly
SELECT time_bucket('5 minutes', time), ... FROM ohlcv_1m GROUP BY ...
```

---

## Security Considerations

### 1. API Key Management

```typescript
// ✅ Store in environment variables
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;

// ❌ Never hardcode
const BINANCE_API_KEY = 'abc123...';
```

### 2. Rate Limiting

Already implemented in `RateLimitGuard`:
- 100 requests per 60 seconds per IP
- Returns 429 with `Retry-After` header

### 3. Input Validation

```typescript
// Use Zod or class-validator
export class OhlcvQueryDto {
  @IsString()
  @IsNotEmpty()
  symbol: string;

  @IsIn(['1m', '5m', '1h', '1d'])
  resolution: string;

  @IsInt()
  @Min(0)
  from: number;

  @IsInt()
  @Min(0)
  to: number;
}
```

### 4. SQL Injection Prevention

✅ TypeORM uses parameterized queries by default:
```typescript
repo.find({ where: { symbol } });  // Safe
```

❌ Avoid raw queries with string concatenation:
```typescript
repo.query(`SELECT * FROM ohlcv WHERE symbol = '${symbol}'`);  // Vulnerable!
```

---

## Monitoring & Alerts

### Key Metrics to Watch

| Metric | Alert Threshold | Description |
|--------|----------------|-------------|
| `oracle_leader_changes_total` | > 5 per hour | Frequent leadership changes indicate instability |
| `oracle_price_updates_total` | < 100 per minute | Ingestion stopped or slowed down |
| `oracle_exchange_health` | < 2 healthy exchanges | Not enough data sources |
| `oracle_flush_duration_seconds` | > 10s (p95) | DB write performance degraded |
| `oracle_ingestion_duration_seconds` | > 1s (p95) | Exchange API latency high |

### Grafana Dashboard

```json
{
  "panels": [
    {
      "title": "Price Updates per Symbol",
      "targets": [{
        "expr": "rate(oracle_price_updates_total[5m])"
      }]
    },
    {
      "title": "API Latency (p95)",
      "targets": [{
        "expr": "histogram_quantile(0.95, oracle_api_duration_seconds_bucket)"
      }]
    }
  ]
}
```

---

## CI/CD Pipeline

### Required Checks

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install dependencies
        run: npm ci
      - name: Lint
        run: npm run lint
      - name: Unit tests
        run: npm run test
      - name: E2E tests
        run: npm run test:e2e
      - name: Coverage check
        run: npm run test:cov
        # Fail if coverage < 80%
      - name: Build
        run: npm run build
```

### Deployment Strategy

1. **Blue-Green Deployment**:
   - Deploy new version (green) alongside old (blue)
   - New instances won't become leader immediately
   - Once healthy, shift traffic to green
   - Old instances gracefully shut down

2. **Rolling Update**:
   - Update instances one by one
   - Leader election ensures only one active ingestion
   - Zero downtime for API (all instances serve reads)

---

## FAQs

**Q: Why use Redis + TimescaleDB instead of just TimescaleDB?**
A: Redis provides sub-millisecond writes for real-time candle updates (every second). TimescaleDB is optimized for batch inserts and analytical queries. This hybrid approach balances real-time performance with long-term storage efficiency.

**Q: Why not use a message queue (RabbitMQ, Kafka)?**
A: For this use case, Redis is sufficient. Message queues add complexity without significant benefit. If we scale to 1000+ symbols or need replay capability, consider Kafka.

**Q: What happens if Redis goes down?**
A: Ingestion stops (leader election fails), but API still works (serves historical data from DB). Current candle becomes stale. When Redis recovers, backfill service detects gaps and fills them from exchange APIs.

**Q: Can I run multiple clusters in different regions?**
A: Yes, but each cluster needs its own Redis instance for leader election. They can share the same TimescaleDB (write to different partitions) or replicate data between regions.

**Q: How to handle exchange API rate limits?**
A: Use a token bucket algorithm per exchange. The circuit breaker will open if rate limit errors exceed threshold.

---

## Best Practices Summary

✅ **DO**:
- Use leader election for all write operations
- Use Lua scripts for atomic Redis operations
- Implement circuit breakers for external APIs
- Write comprehensive tests (80%+ coverage)
- Use structured logging with context
- Monitor key metrics with Prometheus
- Use continuous aggregates for higher timeframes
- Implement graceful shutdown

❌ **DON'T**:
- Delete Redis keys before DB write confirmation
- Hardcode exchange API keys
- Run write operations on all instances
- Use HGETALL + HMSET without atomic wrapper
- Query raw `ohlcv_1m` for 5m+ timeframes
- Skip input validation on API endpoints
- Deploy without health checks
- Ignore circuit breaker states

---

## Quick Command Reference

```bash
# Development
npm run start:dev          # Start with hot reload
npm run test              # Run unit tests
npm run test:e2e          # Run E2E tests
npm run test:cov          # Coverage report
npm run lint              # ESLint check
npm run format            # Prettier format

# Database
npm run migration:generate -- -n MigrationName
npm run migration:run
npm run migration:revert

# Docker
docker-compose up -d      # Start services
docker-compose logs -f    # View logs
docker-compose down       # Stop services

# Redis CLI
redis-cli GET oracle:leader:election
redis-cli KEYS "oracle:candle:*"
redis-cli HGETALL oracle:candle:BTC/USDT:current

# PostgreSQL CLI
psql -h localhost -U oracle_user -d oracle_db
\dt                       # List tables
\d ohlcv_1m              # Describe table
SELECT * FROM ohlcv_1m ORDER BY time DESC LIMIT 10;
```

---

**Last Updated**: 2024-01-01
**Maintainer**: Development Team
**Questions?**: Create an issue on GitHub
