# Token Price Oracle

Cryptocurrency price aggregation system that collects data from multiple exchanges (Binance, Upbit), aggregates them using statistical algorithms, and provides OHLCV time-series data through REST API.

## Tech Stack

- **Runtime**: Bun 1.3+ (for development and testing)
- **Framework**: NestJS 10 with Fastify adapter
- **Language**: TypeScript 5
- **Database**: PostgreSQL 15 + TimescaleDB 2.13+
- **Cache**: Redis 7
- **ORM**: Drizzle ORM 0.36+

**Performance Optimizations**:
- **Bun**: 3-4x faster than Node.js for package management and testing
- **Fastify** instead of Express: 2-3x faster HTTP processing, optimized JSON serialization
- **Drizzle ORM**: Type-safe SQL queries with minimal overhead
- **Direct exchange APIs**: No CCXT overhead
- **Minimal dependencies**: Reduced bundle size and startup time

## Quick Start

### Option 1: Production (Docker Compose)

```bash
# Build and start all services
docker-compose -f docker-compose.prod.yml up -d

# Check service status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f api

# Initialize database (first time only)
docker-compose -f docker-compose.prod.yml exec api npx prisma migrate deploy

# Setup TimescaleDB extensions (first time only)
docker cp prisma/migrations/001_timescaledb_setup.sql $(docker-compose -f docker-compose.prod.yml ps -q timescaledb):/tmp/
docker-compose -f docker-compose.prod.yml exec timescaledb psql -U oracle_user -d oracle_db -f /tmp/001_timescaledb_setup.sql

# Test API
curl http://localhost:3000/api/v1/market/health
```

### Option 2: Development

#### 1. Start Infrastructure

```bash
# Start Redis and TimescaleDB
docker-compose up -d

# Check services are running
docker-compose ps
```

#### 2. Install Dependencies

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install dependencies
bun install
# or
npm install
```

#### 3. Setup Database

```bash
# Generate Drizzle migrations
bun db:generate

# Push schema to database
bun db:push

# Setup TimescaleDB hypertable (run once)
# This is automatically handled by DrizzleService.enableHypertable()
# Or manually via SQL if needed
```

#### 4. Run Application

```bash
# Development (with hot reload)
npm run start:dev

# Production build
npm run build
bun run start:prod
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Key environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_HOST`, `REDIS_PORT`: Redis connection
- `SYMBOLS`: Comma-separated trading pairs (e.g., `BTC/USDT,ETH/USDT`)

## Project Structure

```
src/
├── clients/         # Exchange API clients (Binance, Upbit)
│   ├── binance.client.ts       # Binance API (spot prices, historical data)
│   ├── upbit.client.ts         # Upbit API (KRW markets)
│   └── *.test.ts              # Client tests
├── config/          # Configuration and Redis setup
├── database/        # Database layer
│   ├── schema.ts              # Drizzle ORM schema
│   ├── drizzle.service.ts     # DB connection & TimescaleDB setup
│   └── database.module.ts     # Database module
├── services/        # Business logic
│   ├── aggregation.service.ts # Price aggregation (VWAP, median)
│   ├── collector.service.ts   # Real-time price collection
│   ├── storage.service.ts     # Periodic DB flushing
│   ├── backfill.service.ts    # Historical data backfill
│   └── fx-rate.service.ts     # Currency conversion & premium calc
├── api/             # REST API controllers
│   ├── market.controller.ts   # Market data endpoints
│   ├── backfill.controller.ts # Backfill endpoints
│   └── dto/                   # Request/response DTOs
├── scripts/         # CLI scripts
│   └── backfill.ts            # Backfill CLI command
├── app.module.ts    # Root module
└── main.ts          # Entry point

drizzle/             # Drizzle migrations
drizzle.config.ts    # Drizzle configuration
```

## Testing

```bash
# Run all tests with Bun
bun test

# Watch mode
bun test --watch

# Coverage
bun test --coverage

# Run specific test files
bun test src/clients/binance.client.test.ts
bun test src/services/backfill.service.test.ts
```

## API Endpoints

### Get Current Price (Ticker)

**Get all markets (quote-separated)**
```bash
GET /api/v1/market/ticker?base=BTC

# Response
{
  "base": "BTC",
  "markets": {
    "USDT": {
      "base": "BTC",
      "quote": "USDT",
      "price": 43000.5,
      "open": 42800.0,
      "high": 43200.0,
      "low": 42700.0,
      "volume": 1234.5,
      "timestamp": 1704110400000,
      "sourceCount": 1
    },
    "KRW": {
      "base": "BTC",
      "quote": "KRW",
      "price": 58500000,
      "open": 58200000,
      "high": 58800000,
      "low": 58000000,
      "volume": 45.2,
      "timestamp": 1704110400000,
      "sourceCount": 1
    }
  }
}
```

**Get specific quote market**
```bash
GET /api/v1/market/ticker?base=BTC&quote=USDT

# Response
{
  "base": "BTC",
  "quote": "USDT",
  "price": 43000.5,
  "open": 42800.0,
  "high": 43200.0,
  "low": 42700.0,
  "volume": 1234.5,
  "timestamp": 1704110400000,
  "sourceCount": 1
}
```

**Get specific exchange**
```bash
GET /api/v1/market/ticker?base=BTC&exchange=binance

# Response
{
  "base": "BTC",
  "exchange": "binance",
  "quote": "USDT",
  "pair": "BTC/USDT",
  "price": 43000.5,
  "volume": 1234.5,
  "timestamp": 1704110400000
}
```

**Get with kimchi premium**
```bash
GET /api/v1/market/ticker?base=BTC&includePremium=true

# Response
{
  "base": "BTC",
  "markets": {
    "USDT": { "price": 43000.5, ... },
    "KRW": { "price": 58500000, ... }
  },
  "premium": {
    "value": "+1.52%",
    "note": "KRW market premium vs USDT market"
  }
}
```

### Get OHLCV Data
```bash
GET /api/v1/market/ohlcv?symbol=BTC/USDT&from=1704110400&to=1704114000
```

### Get Supported Symbols
```bash
GET /api/v1/market/symbols
```

### Health Check
```bash
GET /api/v1/market/health
```

### Backfill Historical Data

**Backfill last 7 days**
```bash
POST /api/v1/backfill?symbol=BTC&days=7

# Response
{
  "base": "BTC",
  "startDate": "2024-11-29T00:00:00.000Z",
  "endDate": "2024-12-06T00:00:00.000Z",
  "totalCandles": 10080,
  "processedCandles": 10080,
  "status": "completed"
}
```

**Backfill last 24 hours**
```bash
POST /api/v1/backfill?symbol=ETH&hours=24
```

**Backfill specific date range**
```bash
POST /api/v1/backfill?symbol=BTC&from=2024-01-01&to=2024-01-31
```

**Backfill with specific exchanges**
```bash
POST /api/v1/backfill?symbol=BTC&days=7&exchanges=binance,upbit
```

### CLI Commands

**Backfill using CLI**
```bash
# Backfill last 7 days
bun backfill --symbol BTC --days 7

# Backfill last 24 hours
bun backfill --symbol ETH --hours 24

# Backfill specific date range
bun backfill --symbol BTC --from 2024-01-01 --to 2024-01-31

# Backfill with specific exchanges
bun backfill --symbol BTC --days 365 --exchanges binance,upbit
```

## Architecture

**Data Flow**:
1. **Collection** (every 1 second): Fetch prices from exchanges → Aggregate → Update Redis
   - Stores 3 keys per symbol: `candle:{symbol}:binance`, `candle:{symbol}:upbit`, `candle:{symbol}:aggregated`
2. **Persistence** (every 1 minute): Flush aggregated candles → Bulk insert to TimescaleDB
   - Only aggregated prices stored in DB (not per-exchange)
   - All Redis keys cleaned after successful DB write
3. **Query**:
   - Historical: Read from TimescaleDB (aggregated only)
   - Current: Read from Redis (per-exchange or aggregated)

**Key Features**:
- Multi-source price aggregation (VWAP/Median)
- Hot/Cold storage strategy:
  - **Redis (hot)**: All exchange prices + aggregated (current minute)
  - **TimescaleDB (cold)**: Aggregated prices only (historical)
- Per-exchange price tracking in real-time
- Continuous aggregates for higher timeframes (5m, 1h)
- Automatic compression and retention policies

## License

MIT
