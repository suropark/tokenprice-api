import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { configuration } from './config/configuration';
import { redisProvider } from './config/redis.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
  ],
  providers: [redisProvider],
  exports: ['REDIS_CLIENT'],
})
export class AppModule {}
