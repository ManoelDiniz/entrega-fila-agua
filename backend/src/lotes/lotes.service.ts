import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { Pedido } from '../entities/pedido.entity';
import { LoteEntrega } from '../entities/lote-entrega.entity';
import { LotePedido } from '../entities/lote-pedido.entity';
import { Auditoria } from '../entities/auditoria.entity';
import { CriarLoteDto } from './dto/criar-lote.dto';
import { ReotimizarDto } from './dto/reotimizar.dto';
import { NaoEntregueDto } from './dto/nao-entregue.dto';
import { RotaService, RotaResultado } from './rota.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { JwtUser } from '../auth/current-user.decorator';

/**
 * Deslocamento temporário aplicado às sequências durante a reotimização.
 * A tabela tem UNIQUE (lote_id, sequencia): para renumerar as paradas sem
 * esbarrar na constraint, primeiro empurramos todas para uma faixa alta e vazia
 * (1001+), depois gravamos os valores finais (1..n). Como um lote tem no máximo
 * 50 pedidos, as duas faixas nunca se cruzam.
 */
const OFFSET_RENUMERACAO = 1000;

@Injectable()
export class LotesService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly rota: RotaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Puxa N pedidos da fila e monta um lote com a rota já otimizada.
   *
   * Concorrência: tudo dentro de UMA transação. Os N primeiros pedidos da fila
   * são travados com SELECT ... FOR UPDATE SKIP LOCKED — assim dois
   * entregadores nunca pegam o mesmo pedido: o segundo simplesmente "pula" as
   * linhas já travadas pelo primeiro e leva as próximas disponíveis, sem espera
   * e sem deadlock. A UNIQUE(pedido_id) em lote_pedidos é a rede de segurança
   * no banco.
   */
  async criarLote(dto: CriarLoteDto, user: JwtUser) {
    const resultado = await this.dataSource.transaction(async (manager) => {
      // 1) Trava os N primeiros da fila (ordem: prioridade, criado_em).
      const pedidosFila = await manager
        .createQueryBuilder(Pedido, 'p')
        .setLock('pessimistic_write')
        .setOnLocked('skip_locked')
        .where('p.status = :status', { status: 'na_fila' })
        // ENUM ('normal','vip','urgente') => DESC dá urgente > vip > normal.
        .orderBy('p.prioridade', 'DESC')
        .addOrderBy('p.criado_em', 'ASC')
        .take(dto.qtd)
        .getMany();

      if (pedidosFila.length === 0) {
        throw new BadRequestException('Não há pedidos disponíveis na fila.');
      }

      const ids = pedidosFila.map((p) => p.id);

      // 2) Marca como atribuido (compare-and-set adicional por segurança).
      await manager
        .createQueryBuilder()
        .update(Pedido)
        .set({ status: 'atribuido' })
        .whereInIds(ids)
        .andWhere('status = :status', { status: 'na_fila' })
        .execute();

      // 3) Cria o lote.
      const lote = await manager.save(
        manager.create(LoteEntrega, {
          entregador_id: user.sub,
          status: 'em_rota',
          qtd_pedidos: pedidosFila.length,
          lat_partida: String(dto.lat),
          lng_partida: String(dto.lng),
        }),
      );

      // 4) Orquestra a rota (OSRM por padrão; Haversine se ele falhar).
      const rota = await this.rota.otimizar(
        { lat: dto.lat, lng: dto.lng },
        pedidosFila,
      );

      // 5) Vincula os pedidos ao lote na sequência calculada.
      await manager.save(
        rota.itens.map((it) =>
          manager.create(LotePedido, {
            lote_id: lote.id,
            pedido_id: it.pedido_id,
            sequencia: it.sequencia,
            distancia_m: it.distancia_m,
            tempo_seg: it.tempo_seg,
          }),
        ),
      );

      // 6) Pedidos do lote passam para em_rota.
      await manager
        .createQueryBuilder()
        .update(Pedido)
        .set({ status: 'em_rota' })
        .whereInIds(ids)
        .execute();

      // 7) Auditoria. Guarda também de onde veio a rota — a tabela de lotes não
      //    tem coluna para isso, e sem esse registro não dá para saber depois se
      //    o lote saiu otimizado ou no fallback.
      await manager.save(
        manager.create(Auditoria, {
          usuario_id: user.sub,
          pedido_id: null,
          acao: 'lote_criado',
          detalhe: this.resumoDaRota(lote.id, pedidosFila.length, rota),
        }),
      );

      return { loteId: lote.id, ids, rota };
    });

    // Eventos de tempo real (fora da transação).
    this.realtime.emitLoteCriado({
      loteId: resultado.loteId,
      entregadorId: user.sub,
      qtd: resultado.ids.length,
    });
    this.realtime.emitFilaAtualizada({
      motivo: 'lote_puxado',
      pedidos: resultado.ids,
    });

    const lote = await this.detalhe(resultado.loteId);

    this.realtime.emitLoteRotaPronta(user.sub, {
      loteId: lote.id,
      sequencia: lote.itens.map((i) => i.sequencia),
    });

    return { ...lote, rota: this.resumo(resultado.rota) };
  }

  async detalhe(id: string) {
    const lote = await this.dataSource.getRepository(LoteEntrega).findOne({
      where: { id },
      relations: {
        itens: { pedido: { cliente: true } },
        entregador: true,
      },
    });
    if (!lote) throw new NotFoundException('Lote não encontrado.');
    lote.itens.sort((a, b) => a.sequencia - b.sequencia);
    return lote;
  }

  listarPorEntregador(entregadorId: string) {
    return this.dataSource.getRepository(LoteEntrega).find({
      where: { entregador_id: entregadorId },
      order: { iniciado_em: 'DESC' },
      take: 50,
    });
  }

  /** Lote em aberto do entregador — é o que a tela recarrega depois de um F5. */
  async emAndamento(entregadorId: string) {
    const lote = await this.dataSource.getRepository(LoteEntrega).findOne({
      where: { entregador_id: entregadorId, status: 'em_rota' },
      order: { iniciado_em: 'DESC' },
    });
    return lote ? this.detalhe(lote.id) : null;
  }

  /** Marca um pedido do lote como entregue. */
  async marcarEntregue(loteId: string, pedidoId: string, user: JwtUser) {
    await this.exigirAcessoAoLote(loteId, user);

    await this.dataSource.transaction(async (manager) => {
      const vinculo = await manager.findOne(LotePedido, {
        where: { lote_id: loteId, pedido_id: pedidoId },
      });
      if (!vinculo) throw new NotFoundException('Pedido não está neste lote.');

      const agora = new Date();
      vinculo.entregue_em = agora;
      await manager.save(vinculo);

      await manager
        .createQueryBuilder()
        .update(Pedido)
        .set({ status: 'entregue', entregue_em: agora })
        .where('id = :id', { id: pedidoId })
        .execute();

      await manager.save(
        manager.create(Auditoria, {
          usuario_id: user.sub,
          pedido_id: pedidoId,
          acao: 'pedido_entregue',
          detalhe: `Pedido ${pedidoId} entregue no lote ${loteId}.`,
        }),
      );
    });

    this.realtime.emitPedidoStatus({ pedidoId, status: 'entregue' });
    this.realtime.emitLotePedidoEntregue({ loteId, pedidoId });

    return this.detalhe(loteId);
  }

  /**
   * Entrega que não aconteceu (cliente ausente, endereço errado, recusou).
   *
   * O pedido VOLTA PARA A FILA e o vínculo com o lote é REMOVIDO. Remover o
   * vínculo é obrigatório, não cosmético: `lote_pedidos` tem UNIQUE(pedido_id),
   * então enquanto a linha existir esse pedido não pode entrar em nenhum outro
   * lote — ficaria preso para sempre, fora da fila e sem ninguém para entregá-lo.
   *
   * O pedido mantém o `criado_em` original, então volta para a POSIÇÃO que já
   * tinha na fila (a ordenação é prioridade + criado_em). Quem já esperou uma
   * tentativa frustrada não vai para o fim da fila.
   *
   * O motivo vai para a `auditoria` — a tabela `lote_pedidos` não tem coluna para
   * ele, e criar uma exigiria mexer no schema.
   */
  async marcarNaoEntregue(
    loteId: string,
    pedidoId: string,
    dto: NaoEntregueDto,
    user: JwtUser,
  ) {
    await this.exigirAcessoAoLote(loteId, user);

    await this.dataSource.transaction(async (manager) => {
      const vinculo = await manager.findOne(LotePedido, {
        where: { lote_id: loteId, pedido_id: pedidoId },
      });
      if (!vinculo) throw new NotFoundException('Pedido não está neste lote.');
      if (vinculo.entregue_em) {
        throw new BadRequestException('Este pedido já foi entregue.');
      }

      // Libera a UNIQUE(pedido_id): sem isto o pedido nunca mais entra num lote.
      await manager.delete(LotePedido, { id: vinculo.id });

      await manager
        .createQueryBuilder()
        .update(Pedido)
        .set({ status: 'na_fila' })
        .where('id = :id', { id: pedidoId })
        .execute();

      const detalhe = dto.observacao
        ? `${dto.motivo}: ${dto.observacao}`
        : dto.motivo;

      await manager.save(
        manager.create(Auditoria, {
          usuario_id: user.sub,
          pedido_id: pedidoId,
          acao: 'pedido_nao_entregue',
          detalhe: `Pedido ${pedidoId} não entregue no lote ${loteId} (${detalhe}). Devolvido à fila.`,
        }),
      );
    });

    this.realtime.emitPedidoStatus({ pedidoId, status: 'na_fila' });
    this.realtime.emitFilaAtualizada({
      motivo: 'nao_entregue',
      pedidoId,
    });

    return this.detalhe(loteId);
  }

  /**
   * Finaliza o lote.
   *
   * RECUSA se ainda houver entrega pendente. Antes isso era permitido, e os
   * pedidos não entregues ficavam presos em `em_rota`: fora da fila, vinculados a
   * um lote encerrado, e — pela UNIQUE(pedido_id) — impossíveis de reatribuir. O
   * cliente simplesmente sumia do sistema, sem erro nenhum.
   *
   * Agora o entregador precisa resolver cada parada explicitamente: entregue, ou
   * não entregue com motivo (aí volta para a fila). Não há caminho silencioso.
   */
  async finalizar(loteId: string, user: JwtUser) {
    const lote = await this.exigirAcessoAoLote(loteId, user);

    const detalhado = await this.detalhe(loteId);
    const pendentes = detalhado.itens.filter((i) => i.entregue_em == null);

    if (pendentes.length > 0) {
      throw new BadRequestException(
        `Há ${pendentes.length} entrega(s) pendente(s) neste lote. ` +
          `Marque cada uma como entregue, ou como não entregue informando o ` +
          `motivo (ela volta para a fila), antes de finalizar.`,
      );
    }

    lote.status = 'finalizado';
    lote.finalizado_em = new Date();
    await this.dataSource.getRepository(LoteEntrega).save(lote);

    await this.dataSource.getRepository(Auditoria).save({
      usuario_id: user.sub,
      pedido_id: null,
      acao: 'lote_finalizado',
      detalhe: `Lote ${loteId} finalizado com ${detalhado.itens.length} entrega(s).`,
    });

    this.realtime.emitLoteFinalizado({ loteId });
    return lote;
  }

  /**
   * Recalcula a rota das entregas ainda pendentes a partir da posição atual do
   * entregador. Serve para quando a rota saiu no fallback (Haversine), quando o
   * entregador desviou do trajeto, ou quando ele simplesmente pede.
   *
   * As paradas já entregues mantêm a ordem em que foram entregues e ficam no
   * começo da sequência; só as pendentes são reordenadas.
   */
  async reotimizar(loteId: string, dto: ReotimizarDto, user: JwtUser) {
    const lote = await this.exigirAcessoAoLote(loteId, user);

    if (lote.status !== 'em_rota') {
      throw new BadRequestException('Só é possível reotimizar um lote em rota.');
    }

    const detalhado = await this.detalhe(loteId);
    const entregues = detalhado.itens.filter((i) => i.entregue_em != null);
    const pendentes = detalhado.itens.filter((i) => i.entregue_em == null);

    if (pendentes.length === 0) {
      throw new BadRequestException(
        'Todas as entregas deste lote já foram feitas.',
      );
    }

    // Partida: a posição atual enviada pelo app; se não vier, o ponto original.
    const partida = {
      lat: dto.lat ?? Number(lote.lat_partida),
      lng: dto.lng ?? Number(lote.lng_partida),
    };
    if (!Number.isFinite(partida.lat) || !Number.isFinite(partida.lng)) {
      throw new BadRequestException(
        'Sem ponto de partida: envie lat/lng da posição atual.',
      );
    }

    const pedidosPendentes = await this.dataSource.getRepository(Pedido).find({
      where: { id: In(pendentes.map((i) => i.pedido_id)) },
    });

    const rota = await this.rota.otimizar(partida, pedidosPendentes);

    await this.dataSource.transaction(async (manager) => {
      await this.renumerar(manager, loteId, entregues, rota);

      await manager.save(
        manager.create(Auditoria, {
          usuario_id: user.sub,
          pedido_id: null,
          acao: 'lote_reotimizado',
          detalhe: this.resumoDaRota(loteId, pendentes.length, rota),
        }),
      );
    });

    const atualizado = await this.detalhe(loteId);

    this.realtime.emitLoteRotaPronta(lote.entregador_id, {
      loteId,
      sequencia: atualizado.itens.map((i) => i.sequencia),
    });

    return { ...atualizado, rota: this.resumo(rota) };
  }

  /**
   * Grava a nova numeração das paradas.
   *
   * Passo 1: empurra TODAS as sequências do lote para a faixa alta (+1000).
   * Passo 2: grava os valores finais — as entregues primeiro (na ordem em que
   *          foram entregues), depois as pendentes na ordem que a rota devolveu.
   *
   * O passo 1 existe por causa do UNIQUE (lote_id, sequencia): sem ele, gravar a
   * parada 3 como 1 colidiria com a parada que ainda ocupa o 1.
   */
  private async renumerar(
    manager: EntityManager,
    loteId: string,
    entregues: LotePedido[],
    rota: RotaResultado,
  ) {
    await manager
      .createQueryBuilder()
      .update(LotePedido)
      .set({ sequencia: () => `sequencia + ${OFFSET_RENUMERACAO}` })
      .where('lote_id = :loteId', { loteId })
      .execute();

    const jaEntregues = [...entregues].sort(
      (a, b) =>
        (a.entregue_em?.getTime() ?? 0) - (b.entregue_em?.getTime() ?? 0),
    );

    let sequencia = 1;

    for (const item of jaEntregues) {
      await manager.update(
        LotePedido,
        { id: item.id },
        { sequencia: sequencia++ },
      );
    }

    for (const item of rota.itens) {
      await manager.update(
        LotePedido,
        { lote_id: loteId, pedido_id: item.pedido_id },
        {
          sequencia: sequencia++,
          distancia_m: item.distancia_m,
          tempo_seg: item.tempo_seg,
        },
      );
    }
  }

  /** Confere que o lote existe e que este usuário pode mexer nele. */
  private async exigirAcessoAoLote(loteId: string, user: JwtUser) {
    const lote = await this.dataSource
      .getRepository(LoteEntrega)
      .findOne({ where: { id: loteId } });

    if (!lote) throw new NotFoundException('Lote não encontrado.');

    if (
      user.perfil !== 'admin' &&
      String(lote.entregador_id) !== String(user.sub)
    ) {
      throw new ForbiddenException('Este lote é de outro entregador.');
    }
    return lote;
  }

  /** Dados da rota devolvidos à tela — não há coluna para eles no banco. */
  private resumo(rota: RotaResultado) {
    return {
      fonte: rota.fonte,
      otimizada: rota.otimizada,
      distancia_total_m: rota.distancia_total_m,
      tempo_total_seg: rota.tempo_total_seg,
      sem_coordenadas: rota.sem_coordenadas,
    };
  }

  private resumoDaRota(loteId: string, qtd: number, rota: RotaResultado) {
    const km = rota.distancia_total_m
      ? (rota.distancia_total_m / 1000).toFixed(1)
      : '?';
    const min = rota.tempo_total_seg
      ? Math.round(rota.tempo_total_seg / 60)
      : '?';
    const semCoord = rota.sem_coordenadas.length
      ? `, ${rota.sem_coordenadas.length} sem coordenadas`
      : '';
    return `Lote ${loteId}: ${qtd} pedido(s), rota via ${rota.fonte} (${km} km, ${min} min)${semCoord}.`;
  }
}
