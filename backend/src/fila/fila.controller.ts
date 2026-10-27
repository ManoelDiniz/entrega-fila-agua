import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { FilaService } from './fila.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'atendente', 'entregador')
@Controller('fila')
export class FilaController {
  constructor(private readonly service: FilaService) {}

  @Get()
  listar(@Query('limite') limite?: string) {
    return this.service.listar(limite ? parseInt(limite, 10) : 100);
  }
}
