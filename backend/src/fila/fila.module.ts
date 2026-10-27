import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pedido } from '../entities/pedido.entity';
import { FilaService } from './fila.service';
import { FilaController } from './fila.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Pedido])],
  controllers: [FilaController],
  providers: [FilaService],
  exports: [FilaService],
})
export class FilaModule {}
