import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration } from '../config/configuration';
import { DatabaseModule } from '../database/database.module';
import { ExchangeModule } from '../clients/exchange.module';
import { BackfillService } from '../services/backfill.service';

/**
 * Backfill-only module that excludes unnecessary services
 * - No Redis (backfill doesn't use Redis)
 * - No CollectorService (no real-time collection needed)
 * - No StorageService flush (backfill writes directly to DB)
 * - No FxRateService (not used in backfill)
 * - No ScheduleModule (no cron jobs needed)
 * - No ApiModule (no HTTP endpoints needed)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    ExchangeModule,
  ],
  providers: [BackfillService],
  exports: [BackfillService],
})
export class BackfillModule {}

