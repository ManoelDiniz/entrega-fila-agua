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
import { ProdutosService } from './produtos.service';
import { CreateProdutoDto } from './dto/create-produto.dto';
import { UpdateProdutoDto } from './dto/update-produto.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('produtos')
export class ProdutosController {
  constructor(private readonly service: ProdutosService) {}

  /**
   * GET /api/produtos          -> TUDO, inclusive desativados (tela de gestão).
   * GET /api/produtos?ativo=1  -> só os ativos (tela de pedido).
   *
   * O filtro é OPT-IN: sem ele vem tudo, para a tela de gestão poder reativar um
   * produto desativado (que, por definição, não apareceria numa lista filtrada).
   *
   * O entregador também lê: a tela de entrega mostra os itens do pedido.
   */
  @Roles('admin', 'atendente', 'entregador')
  @Get()
  findAll(@Query('ativo') ativo?: string) {
    return this.service.findAll(ativo === '1' || ativo === 'true');
  }

  @Roles('admin', 'atendente')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  /**
   * Criar/alterar produto é liberado para o `atendente`, não só para o admin: o
   * dono pediu a tela de cadastro de produto DENTRO da área do atendente.
   */
  @Roles('admin', 'atendente')
  @Post()
  create(@Body() dto: CreateProdutoDto) {
    return this.service.create(dto);
  }

  /**
   * Também é aqui que se desativa/reativa: `{ "ativo": 0 }` / `{ "ativo": 1 }`.
   *
   * NÃO existe DELETE de propósito. Chegou a existir, desativando em vez de
   * apagar — e um verbo `DELETE` que não apaga engana quem lê o código depois.
   * Apagar de verdade também não é opção: produto já vendido está referenciado em
   * `pedido_itens` (FK ON DELETE RESTRICT) e levaria o histórico do pedido junto.
   */
  @Roles('admin', 'atendente')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProdutoDto) {
    return this.service.update(id, dto);
  }
}
