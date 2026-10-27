import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pedido } from '../entities/pedido.entity';

/**
 * A "fila" NÃO é uma tabela: é a query sobre pedidos com status='na_fila'
 * ordenada por prioridade (urgente > vip > normal) e depois por criado_em
 * (FIFO). O índice idx_pedidos_fila (status, prioridade, criado_em) serve
 * exatamente este filtro + ordenação.
 */
@Injectable()
export class FilaService {
  constructor(
    @InjectRepository(Pedido)
    private readonly pedidos: Repository<Pedido>,
  ) {}

  private baseQuery() {
    return this.pedidos
      .createQueryBuilder('p')
      .where('p.status = :status', { status: 'na_fila' })
      // O ENUM prioridade é declarado como ('normal','vip','urgente'); no MySQL
      // ordenar por ENUM usa o índice de declaração (normal=1, vip=2, urgente=3),
      // então DESC entrega urgente > vip > normal. Depois FIFO por criado_em.
      .orderBy('p.prioridade', 'DESC')
      .addOrderBy('p.criado_em', 'ASC');
  }

  /** Fila corrente (limitada para exibição). */
  async listar(limite = 100) {
    const pedidos = await this.baseQuery()
      .leftJoinAndSelect('p.cliente', 'cliente')
      .take(limite)
      .getMany();

    const contagem = await this.contarPorPrioridade();
    return { total: contagem.total, contagem, pedidos };
  }

  async contarPorPrioridade() {
    const rows = await this.pedidos
      .createQueryBuilder('p')
      .select('p.prioridade', 'prioridade')
      .addSelect('COUNT(*)', 'qtd')
      .where('p.status = :status', { status: 'na_fila' })
      .groupBy('p.prioridade')
      .getRawMany<{ prioridade: string; qtd: string }>();

    const contagem = { normal: 0, vip: 0, urgente: 0, total: 0 };
    for (const r of rows) {
      const q = Number(r.qtd);
      contagem[r.prioridade as 'normal' | 'vip' | 'urgente'] = q;
      contagem.total += q;
    }
    return contagem;
  }
}
