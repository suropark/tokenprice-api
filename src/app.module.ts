import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { configuration } from './config/configuration';
import { RedisModule } from './config/redis.module';
import { DatabaseModule } from './database/database.module';
import { ServicesModule } from './services/services.module';
import { ApiModule } from './api/api.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
    RedisModule,
    DatabaseModule,
    ServicesModule,
    ApiModule,
  ],
})
export class AppModule {}
