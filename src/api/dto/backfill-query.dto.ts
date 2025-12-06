import { IsString, IsOptional, IsInt, Min, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';

export class BackfillQueryDto {
  @IsString()
  symbol: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  days?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  hours?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsString()
  exchanges?: string; // Comma-separated list: "binance,upbit"
}
