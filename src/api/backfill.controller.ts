import { Controller, Post, Query, ValidationPipe, BadRequestException } from '@nestjs/common';
import { BackfillService, BackfillProgress } from '../services/backfill.service';
import { BackfillQueryDto } from './dto/backfill-query.dto';

@Controller('api/v1/backfill')
export class BackfillController {
  constructor(private readonly backfillService: BackfillService) {}

  /**
   * Trigger a backfill operation
   *
   * Examples:
   *   POST /api/v1/backfill?symbol=BTC&days=7
   *   POST /api/v1/backfill?symbol=ETH&hours=24
   *   POST /api/v1/backfill?symbol=BTC&from=2024-01-01&to=2024-01-31
   *   POST /api/v1/backfill?symbol=BTC&days=7&exchanges=binance,upbit
   */
  @Post()
  async backfill(
    @Query(new ValidationPipe({ transform: true })) query: BackfillQueryDto,
  ): Promise<BackfillProgress> {
    const { symbol, days, hours, from, to, exchanges } = query;

    const exchangeList = exchanges ? exchanges.split(',') : undefined;

    // Validate input
    if (!days && !hours && (!from || !to)) {
      throw new BadRequestException('Either days, hours, or from/to must be specified');
    }

    if ((from && !to) || (!from && to)) {
      throw new BadRequestException('Both from and to must be specified together');
    }

    try {
      if (days) {
        return await this.backfillService.backfillLastDays(symbol, days, exchangeList);
      } else if (hours) {
        return await this.backfillService.backfillLastHours(symbol, hours, exchangeList);
      } else if (from && to) {
        return await this.backfillService.backfill({
          base: symbol,
          startDate: new Date(from),
          endDate: new Date(to),
          exchanges: exchangeList,
        });
      }
    } catch (error) {
      throw new BadRequestException(`Backfill failed: ${error.message}`);
    }
  }
}
