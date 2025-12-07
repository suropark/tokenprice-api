CREATE TABLE IF NOT EXISTS "ohlcv_1m" (
	"time" timestamp with time zone NOT NULL,
	"symbol" text NOT NULL,
	"open" numeric(20, 8) NOT NULL,
	"high" numeric(20, 8) NOT NULL,
	"low" numeric(20, 8) NOT NULL,
	"close" numeric(20, 8) NOT NULL,
	"volume" numeric(30, 8) DEFAULT 0 NOT NULL,
	"quote_volume" numeric(30, 8) DEFAULT 0 NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ohlcv_1m_time_symbol_pk" PRIMARY KEY("time","symbol")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ohlcv_1m_symbol_time_idx" ON "ohlcv_1m" USING btree ("symbol","time");