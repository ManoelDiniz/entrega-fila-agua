import { Global, Module } from '@nestjs/common';
import { GeoService } from './geo.service';
import { GeoController } from './geo.controller';

/**
 * Global: geocodificação é usada por clientes (cadastro) e pode ser usada por
 * pedidos, sem precisar reimportar o módulo em cada um.
 */
@Global()
@Module({
  controllers: [GeoController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
