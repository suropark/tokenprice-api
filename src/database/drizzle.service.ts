import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { sql } from 'drizzle-orm';

@Injectable()
export class DrizzleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DrizzleService.name);
  private client: postgres.Sql;
  public db: PostgresJsDatabase<typeof schema>;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    try {
      const databaseUrl =
        this.configService.get<string>('databaseUrl') ||
        this.configService.get<string>('DATABASE_URL') ||
        'postgresql://oracle_user:oracle_pass@localhost:5432/oracle_db';

      // Create postgres client
      this.client = postgres(databaseUrl, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 10,
      });

      // Initialize Drizzle with schema
      this.db = drizzle(this.client, { schema });

      // Test connection
      await this.db.execute(sql`SELECT 1`);

      this.logger.log('✅ Connected to database via Drizzle');
    } catch (error) {
      this.logger.error('❌ Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.end();
      this.logger.log('Disconnected from database');
    }
  }

  /**
   * Enable TimescaleDB hypertable for ohlcv_1m table
   * This should be called once during initial setup
   */
  async enableHypertable() {
    try {
      // Create TimescaleDB extension if not exists
      await this.db.execute(sql`CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE`);

      // Convert table to hypertable
      await this.db.execute(
        sql`SELECT create_hypertable('ohlcv_1m', 'time', if_not_exists => TRUE, chunk_time_interval => INTERVAL '1 day')`,
      );

      // Set compression policy (compress data older than 7 days)
      await this.db.execute(
        sql`ALTER TABLE ohlcv_1m SET (
          timescaledb.compress,
          timescaledb.compress_segmentby = 'symbol'
        )`,
      );

      await this.db.execute(
        sql`SELECT add_compression_policy('ohlcv_1m', INTERVAL '7 days', if_not_exists => TRUE)`,
      );

      // Set retention policy (drop chunks older than 1 year)
      await this.db.execute(
        sql`SELECT add_retention_policy('ohlcv_1m', INTERVAL '1 year', if_not_exists => TRUE)`,
      );

      this.logger.log('✅ TimescaleDB hypertable enabled for ohlcv_1m');
    } catch (error) {
      this.logger.error('❌ Failed to enable hypertable', error);
      throw error;
    }
  }
}
