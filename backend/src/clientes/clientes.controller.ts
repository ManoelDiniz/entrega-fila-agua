import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClientesService } from './clientes.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { UpdateClienteDto } from './dto/update-cliente.dto';
import { CoordenadasDto } from './dto/coordenadas.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('atendente', 'admin')
@Controller('clientes')
export class ClientesController {
  constructor(private readonly service: ClientesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  /**
   * Geocodifica em lote os clientes que estão sem coordenadas.
   * Declarado ANTES de :id — senão "geocodificar-pendentes" casaria com a rota
   * de parâmetro e seria tratado como um id de cliente.
   */
  @Roles('admin')
  @Post('geocodificar-pendentes')
  geocodificarPendentes() {
    return this.service.geocodificarPendentes();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateClienteDto) {
    return this.service.create(dto);
  }

  /**
   * Edita o cliente. Se o endereço mudar e lat/lng não vierem, regeocodifica —
   * corrigir o endereço conserta o ponto no mapa junto.
   */
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClienteDto) {
    return this.service.update(id, dto);
  }

  /** Ajuste só das coordenadas (ex.: arrastar o pino no mapa). */
  @Patch(':id/coordenadas')
  atualizarCoordenadas(@Param('id') id: string, @Body() dto: CoordenadasDto) {
    return this.service.atualizarCoordenadas(id, dto.lat, dto.lng);
  }
}
