import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PedidosService } from './pedidos.service';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('pedidos')
export class PedidosController {
  constructor(private readonly service: PedidosService) {}

  @Roles('atendente', 'admin', 'entregador')
  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('prioridade') prioridade?: string,
    @Query('cliente_id') cliente_id?: string,
  ) {
    return this.service.findAll({ status, prioridade, cliente_id });
  }

  @Roles('atendente', 'admin', 'entregador')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Roles('atendente', 'admin')
  @Post()
  create(@Body() dto: CreatePedidoDto, @CurrentUser() user: JwtUser) {
    return this.service.create(dto, user);
  }

  @Roles('atendente', 'admin')
  @Patch(':id/cancelar')
  cancelar(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.cancelar(id, user);
  }
}
