import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { Pedido } from '../entities/pedido.entity';
import { PedidoItem } from '../entities/pedido-item.entity';
import { Produto } from '../entities/produto.entity';
import { Cliente } from '../entities/cliente.entity';
import { LotePedido } from '../entities/lote-pedido.entity';
import { Auditoria } from '../entities/auditoria.entity';
import { CreatePedidoDto } from './dto/create-pedido.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { JwtUser } from '../auth/current-user.decorator';

@Injectable()
export class PedidosService {
  constructor(
    @InjectRepository(Pedido)
    private readonly pedidos: Repository<Pedido>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly realtime: RealtimeGateway,
  ) {}

  findAll(filtro: { status?: string; prioridade?: string; cliente_id?: string }) {
    const where: Record<string, unknown> = {};
    if (filtro.status) where.status = filtro.status;
    if (filtro.prioridade) where.prioridade = filtro.prioridade;
    if (filtro.cliente_id) where.cliente_id = filtro.cliente_id;
    return this.pedidos.find({
      where,
      order: { criado_em: 'DESC' },
      take: 200,
    });
  }

  async findOne(id: string) {
    const pedido = await this.pedidos.findOne({
      where: { id },
      relations: { itens: true, cliente: true },
    });
    if (!pedido) throw new NotFoundException('Pedido não encontrado.');
    return pedido;
  }

  async create(dto: CreatePedidoDto, user: JwtUser) {
    const pedidoId = await this.dataSource.transaction(async (manager) => {
      const cliente = await manager.findOne(Cliente, {
        where: { id: dto.cliente_id },
      });
      if (!cliente) throw new BadRequestException('Cliente inexistente.');

      const produtoIds = dto.itens.map((i) => i.produto_id);
      const produtos = await manager.find(Produto, {
        where: { id: In(produtoIds) },
      });
      if (produtos.length !== new Set(produtoIds).size) {
        throw new BadRequestException('Um ou mais produtos são inválidos.');
      }
      const mapaProduto = new Map(produtos.map((p) => [p.id, p]));

      let valorTotal = 0;
      const itens = dto.itens.map((i) => {
        const produto = mapaProduto.get(i.produto_id)!;
        const precoUnit = Number(produto.preco);
        valorTotal += precoUnit * i.quantidade;
        return manager.create(PedidoItem, {
          produto_id: i.produto_id,
          quantidade: i.quantidade,
          preco_unit: precoUnit.toFixed(2),
        });
      });

      // Coordenadas: usa as do pedido, senão herda do cliente.
      const lat =
        dto.lat != null ? String(dto.lat) : cliente.lat != null ? cliente.lat : null;
      const lng =
        dto.lng != null ? String(dto.lng) : cliente.lng != null ? cliente.lng : null;

      const pedido = manager.create(Pedido, {
        cliente_id: dto.cliente_id,
        atendente_id: user.sub,
        status: 'na_fila',
        prioridade: dto.prioridade ?? 'normal',
        lat,
        lng,
        valor_total: valorTotal.toFixed(2),
        observacao: dto.observacao ?? null,
      });
      const salvo = await manager.save(pedido);

      itens.forEach((item) => (item.pedido_id = salvo.id));
      await manager.save(itens);

      await manager.save(
        manager.create(Auditoria, {
          usuario_id: user.sub,
          pedido_id: salvo.id,
          acao: 'pedido_criado',
          detalhe: `Pedido ${salvo.id} entrou na fila (${salvo.prioridade}).`,
        }),
      );

      return salvo.id;
    });

    const pedido = await this.findOne(pedidoId);

    // Eventos de fila em tempo real.
    this.realtime.emitPedidoNovo({ id: pedido.id, prioridade: pedido.prioridade });
    this.realtime.emitFilaAtualizada({ motivo: 'novo_pedido', pedidoId: pedido.id });

    return pedido;
  }

  /**
   * Cancela o pedido, inclusive se ele já estiver num lote.
   *
   * O vínculo em `lote_pedidos` PRECISA ser removido junto. Sem isso ele fica
   * órfão: a linha continua apontando para um pedido cancelado e, pela
   * UNIQUE(pedido_id), aquele pedido nunca mais poderia entrar em outro lote —
   * o que importa se alguém decidir reativá-lo. Além disso, o lote continuaria
   * mostrando uma parada que ninguém vai entregar.
   */
  async cancelar(id: string, user: JwtUser) {
    const pedido = await this.dataSource.transaction(async (manager) => {
      const pedido = await manager.findOne(Pedido, { where: { id } });
      if (!pedido) throw new NotFoundException('Pedido não encontrado.');
      if (pedido.status === 'entregue') {
        throw new BadRequestException(
          'Pedido já entregue não pode ser cancelado.',
        );
      }

      const vinculo = await manager.findOne(LotePedido, {
        where: { pedido_id: id },
      });

      if (vinculo?.entregue_em) {
        throw new BadRequestException(
          'Pedido já entregue neste lote não pode ser cancelado.',
        );
      }

      if (vinculo) {
        await manager.delete(LotePedido, { id: vinculo.id });
      }

      pedido.status = 'cancelado';
      await manager.save(pedido);

      await manager.save(
        manager.create(Auditoria, {
          usuario_id: user.sub,
          pedido_id: id,
          acao: 'pedido_cancelado',
          detalhe: vinculo
            ? `Pedido ${id} cancelado e removido do lote ${vinculo.lote_id}.`
            : `Pedido ${id} cancelado.`,
        }),
      );

      return pedido;
    });

    this.realtime.emitPedidoStatus({ pedidoId: id, status: 'cancelado' });
    this.realtime.emitFilaAtualizada({ motivo: 'cancelado', pedidoId: id });
    return pedido;
  }
}
