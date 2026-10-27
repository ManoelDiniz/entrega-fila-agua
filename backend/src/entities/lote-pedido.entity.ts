import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LoteEntrega } from './lote-entrega.entity';
import { Pedido } from './pedido.entity';

@Entity('lote_pedidos')
// Um pedido só pode estar em um lote por vez (rede de segurança da fila)
@Index('uq_pedido_unico', ['pedido_id'], { unique: true })
@Index('uq_lote_pedido', ['lote_id', 'pedido_id'], { unique: true })
@Index('uq_lote_sequencia', ['lote_id', 'sequencia'], { unique: true })
export class LotePedido {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_lote_pedidos_lote')
  @Column({ name: 'lote_id', type: 'bigint', unsigned: true })
  lote_id: string;

  @Column({ name: 'pedido_id', type: 'bigint', unsigned: true })
  pedido_id: string;

  @Column({ type: 'int', unsigned: true })
  sequencia: number;

  @Column({ name: 'distancia_m', type: 'int', unsigned: true, nullable: true })
  distancia_m: number | null;

  @Column({ name: 'tempo_seg', type: 'int', unsigned: true, nullable: true })
  tempo_seg: number | null;

  @Column({ name: 'entregue_em', type: 'timestamp', nullable: true })
  entregue_em: Date | null;

  @ManyToOne(() => LoteEntrega, (lote) => lote.itens)
  @JoinColumn({ name: 'lote_id' })
  lote: LoteEntrega;

  @ManyToOne(() => Pedido)
  @JoinColumn({ name: 'pedido_id' })
  pedido: Pedido;
}
