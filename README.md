# Token Price Oracle

Cryptocurrency price aggregation system that collects data from multiple exchanges (Binance, Upbit), aggregates them using statistical algorithms, and provides OHLCV time-series data through REST API.

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: NestJS 10 with Fastify adapter
- **Language**: TypeScript 5
- **Database**: PostgreSQL 15 + TimescaleDB 2.13+
- **Cache**: Redis 7
- **ORM**: Prisma 5

**Performance Optimizations**:
- **Fastify** instead of Express: 2-3x faster HTTP processing, optimized JSON serialization
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
npm install
```

#### 3. Setup Database

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev --name init

# Setup TimescaleDB (hypertable, compression, continuous aggregates)
docker cp prisma/migrations/001_timescaledb_setup.sql $(docker-compose ps -q timescaledb):/tmp/
docker-compose exec timescaledb psql -U oracle_user -d oracle_db -f /tmp/001_timescaledb_setup.sql
```

#### 4. Run Application

```bash
# Development (with hot reload)
npm run start:dev

# Production build
npm run build
npm run start:prod
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
├── config/          # Configuration and Redis setup
├── database/        # Prisma service
├── services/        # Business logic (Aggregation, Collector, Storage)
├── api/             # REST API controllers
├── app.module.ts    # Root module
└── main.ts          # Entry point

prisma/
├── schema.prisma    # Database schema
└── migrations/      # Migration files
```

## Testing

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Coverage
npm run test:cov
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
