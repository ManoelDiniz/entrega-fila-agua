import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Global para que qualquer serviço (Pedidos, Lotes, Produtos) possa injetar o
 * RealtimeGateway e emitir eventos em tempo real.
 *
 * O JwtModule entra aqui porque o gateway valida o token no handshake do
 * Socket.io: a identidade de quem conecta vem do JWT, não do que o cliente diz.
 * O segredo é o MESMO do AuthModule (JWT_SECRET) — se divergir, o login funciona
 * e o socket recusa tudo, que é um jeito bem confuso de quebrar.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
