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
import { LotesService } from './lotes.service';
import { CriarLoteDto } from './dto/criar-lote.dto';
import { ReotimizarDto } from './dto/reotimizar.dto';
import { NaoEntregueDto } from './dto/nao-entregue.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lotes')
export class LotesController {
  constructor(private readonly service: LotesService) {}

  /** Entregador puxa N pedidos da fila e recebe a rota. */
  @Roles('entregador')
  @Post()
  criar(@Body() dto: CriarLoteDto, @CurrentUser() user: JwtUser) {
    return this.service.criarLote(dto, user);
  }

  /**
   * Lote que o entregador ainda está fazendo. É o que a tela busca ao abrir,
   * para o entregador não perder a rota ao recarregar a página.
   * Declarado ANTES de :id — senão "em-andamento" seria tratado como um id.
   */
  @Roles('entregador')
  @Get('em-andamento')
  emAndamento(@CurrentUser() user: JwtUser) {
    return this.service.emAndamento(user.sub);
  }

  @Roles('entregador', 'admin')
  @Get(':id')
  detalhe(@Param('id') id: string) {
    return this.service.detalhe(id);
  }

  @Roles('entregador', 'admin')
  @Get()
  listar(
    @Query('entregador_id') entregadorId: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.listarPorEntregador(entregadorId ?? user.sub);
  }

  @Roles('entregador')
  @Patch(':id/pedidos/:pedidoId/entregue')
  entregue(
    @Param('id') id: string,
    @Param('pedidoId') pedidoId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.marcarEntregue(id, pedidoId, user);
  }

  /**
   * Entrega que não aconteceu. O pedido VOLTA PARA A FILA (mantendo a posição
   * que já tinha) e o motivo fica na auditoria.
   *
   * É o único jeito de tirar uma parada do lote sem entregá-la — e é obrigatório
   * usá-lo antes de finalizar, porque `finalizar` recusa lote com pendências.
   */
  @Roles('entregador')
  @Patch(':id/pedidos/:pedidoId/nao-entregue')
  naoEntregue(
    @Param('id') id: string,
    @Param('pedidoId') pedidoId: string,
    @Body() dto: NaoEntregueDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.marcarNaoEntregue(id, pedidoId, dto, user);
  }

  /** Recusa (400) se houver entrega pendente — resolva cada parada antes. */
  @Roles('entregador')
  @Patch(':id/finalizar')
  finalizar(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.service.finalizar(id, user);
  }

  /**
   * Recalcula a rota das entregas pendentes a partir da posição atual do
   * entregador (envie lat/lng no corpo; sem eles, usa a partida original).
   */
  @Roles('entregador', 'admin')
  @Post(':id/reotimizar')
  reotimizar(
    @Param('id') id: string,
    @Body() dto: ReotimizarDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.service.reotimizar(id, dto, user);
  }
}
