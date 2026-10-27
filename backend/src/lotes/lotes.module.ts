import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoteEntrega } from '../entities/lote-entrega.entity';
import { LotePedido } from '../entities/lote-pedido.entity';
import { Pedido } from '../entities/pedido.entity';
import { LotesService } from './lotes.service';
import { LotesController } from './lotes.controller';
import { RotaService } from './rota.service';

@Module({
  imports: [TypeOrmModule.forFeature([LoteEntrega, LotePedido, Pedido])],
  controllers: [LotesController],
  providers: [LotesService, RotaService],
  exports: [LotesService],
})
export class LotesModule {}
