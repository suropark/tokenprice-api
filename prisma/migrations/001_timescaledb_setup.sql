-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Convert ohlcv_1m to hypertable (must be run after table creation)
-- This will be executed manually after `prisma migrate dev`
SELECT create_hypertable('ohlcv_1m', 'time', if_not_exists => TRUE, chunk_time_interval => INTERVAL '1 week');

-- Enable compression
ALTER TABLE ohlcv_1m SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'symbol',
  timescaledb.compress_orderby = 'time DESC'
);

-- Add compression policy (compress data older than 7 days)
SELECT add_compression_policy('ohlcv_1m', INTERVAL '7 days', if_not_exists => TRUE);

-- Add retention policy (drop data older than 2 years)
SELECT add_retention_policy('ohlcv_1m', INTERVAL '2 years', if_not_exists => TRUE);

-- Create continuous aggregate for 5-minute candles
CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_5m
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('5 minutes', time) AS bucket,
    symbol,
    FIRST(open, time) AS open,
    MAX(high) AS high,
    MIN(low) AS low,
    LAST(close, time) AS close,
    SUM(volume) AS volume,
    SUM(quote_volume) AS quote_volume,
    AVG(source_count::numeric) AS avg_source_count
FROM ohlcv_1m
GROUP BY bucket, symbol
WITH NO DATA;

-- Add refresh policy for 5-minute aggregate
SELECT add_continuous_aggregate_policy('ohlcv_5m',
    start_offset => INTERVAL '10 minutes',
    end_offset => INTERVAL '1 minute',
    schedule_interval => INTERVAL '1 minute',
    if_not_exists => TRUE
);

-- Create continuous aggregate for 1-hour candles
CREATE MATERIALIZED VIEW IF NOT EXISTS ohlcv_1h
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    symbol,
    FIRST(open, time) AS open,
    MAX(high) AS high,
    MIN(low) AS low,
    LAST(close, time) AS close,
    SUM(volume) AS volume,
    SUM(quote_volume) AS quote_volume,
    AVG(source_count::numeric) AS avg_source_count
FROM ohlcv_1m
GROUP BY bucket, symbol
WITH NO DATA;

-- Add refresh policy for 1-hour aggregate
SELECT add_continuous_aggregate_policy('ohlcv_1h',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);
