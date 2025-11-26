import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { configuration } from './config/configuration';
import { redisProvider } from './config/redis.config';
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
    DatabaseModule,
    ServicesModule,
    ApiModule,
  ],
  providers: [redisProvider],
  exports: ['REDIS_CLIENT'],
})
export class AppModule {}
