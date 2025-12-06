#!/usr/bin/env node
/**
 * Backfill script for historical data
 *
 * Usage:
 *   bun run backfill --symbol BTC --days 7
 *   bun run backfill --symbol ETH --hours 24
 *   bun run backfill --symbol BTC --from 2024-01-01 --to 2024-01-31
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BackfillService } from '../services/backfill.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const backfillService = app.get(BackfillService);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const params: any = {};

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace('--', '');
    const value = args[i + 1];
    params[key] = value;
  }

  // Validate required parameters
  if (!params.symbol) {
    console.error('Error: --symbol is required');
    console.log('\nUsage:');
    console.log('  bun run backfill --symbol BTC --days 7');
    console.log('  bun run backfill --symbol ETH --hours 24');
    console.log('  bun run backfill --symbol BTC --from 2024-01-01 --to 2024-01-31');
    process.exit(1);
  }

  try {
    let result;

    if (params.days) {
      console.log(`Backfilling last ${params.days} days for ${params.symbol}...`);
      result = await backfillService.backfillLastDays(
        params.symbol,
        parseInt(params.days),
        params.exchanges?.split(','),
      );
    } else if (params.hours) {
      console.log(`Backfilling last ${params.hours} hours for ${params.symbol}...`);
      result = await backfillService.backfillLastHours(
        params.symbol,
        parseInt(params.hours),
        params.exchanges?.split(','),
      );
    } else if (params.from && params.to) {
      const startDate = new Date(params.from);
      const endDate = new Date(params.to);
      console.log(
        `Backfilling ${params.symbol} from ${startDate.toISOString()} to ${endDate.toISOString()}...`,
      );
      result = await backfillService.backfill({
        base: params.symbol,
        startDate,
        endDate,
        exchanges: params.exchanges?.split(','),
      });
    } else {
      console.error('Error: Either --days, --hours, or --from/--to must be specified');
      process.exit(1);
    }

    console.log('\n✅ Backfill completed successfully!');
    console.log(`  Total candles: ${result.totalCandles}`);
    console.log(`  Processed: ${result.processedCandles}`);
    console.log(`  Status: ${result.status}`);

    if (result.error) {
      console.error(`  Error: ${result.error}`);
    }
  } catch (error) {
    console.error('\n❌ Backfill failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await app.close();
  }
}

bootstrap();
