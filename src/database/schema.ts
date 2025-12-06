import {
  pgTable,
  timestamp,
  text,
  decimal,
  integer,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * OHLCV 1-minute candles table
 * Designed to be used as a TimescaleDB hypertable partitioned by time
 */
export const ohlcv1m = pgTable(
  'ohlcv_1m',
  {
    time: timestamp('time', { withTimezone: true, mode: 'date' }).notNull(),
    symbol: text('symbol').notNull(),
    open: decimal('open', { precision: 20, scale: 8 }).notNull(),
    high: decimal('high', { precision: 20, scale: 8 }).notNull(),
    low: decimal('low', { precision: 20, scale: 8 }).notNull(),
    close: decimal('close', { precision: 20, scale: 8 }).notNull(),
    volume: decimal('volume', { precision: 30, scale: 8 })
      .notNull()
      .default(sql`0`),
    quoteVolume: decimal('quote_volume', { precision: 30, scale: 8 })
      .notNull()
      .default(sql`0`),
    sourceCount: integer('source_count').notNull().default(0),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.time, table.symbol] }),
    symbolTimeIdx: index('ohlcv_1m_symbol_time_idx').on(table.symbol, table.time),
  })
);

// Type inference for insert and select operations
export type Ohlcv1m = typeof ohlcv1m.$inferSelect;
export type NewOhlcv1m = typeof ohlcv1m.$inferInsert;
