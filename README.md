# Token Price Oracle

Cryptocurrency price aggregation system that collects data from multiple exchanges (Binance, Upbit), aggregates them using statistical algorithms, and provides OHLCV time-series data through REST API.

## Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: NestJS 10
- **Language**: TypeScript 5
- **Database**: PostgreSQL 15 + TimescaleDB 2.13+
- **Cache**: Redis 7
- **ORM**: Prisma 5

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

### Get OHLCV Data
```
GET /api/v1/market/ohlcv?symbol=BTC/USDT&from=1704110400&to=1704114000
```

### Get Supported Symbols
```
GET /api/v1/market/symbols
```

### Health Check
```
GET /api/v1/health
```

## Architecture

**Data Flow**:
1. **Collection** (every 1 second): Fetch prices from exchanges → Aggregate → Update Redis
2. **Persistence** (every 1 minute): Flush Redis candles → Bulk insert to TimescaleDB
3. **Query**: Read historical data from DB + current candle from Redis

**Key Features**:
- Multi-source price aggregation (VWAP/Median)
- Hot/Cold storage (Redis + TimescaleDB)
- Continuous aggregates for higher timeframes (5m, 1h)
- Automatic compression and retention policies

## License

MIT
