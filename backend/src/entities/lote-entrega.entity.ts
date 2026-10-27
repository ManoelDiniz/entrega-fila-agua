import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Usuario } from './usuario.entity';
import { LotePedido } from './lote-pedido.entity';

export type StatusLote = 'em_rota' | 'finalizado';

@Entity('lotes_entrega')
export class LoteEntrega {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_lotes_entregador')
  @Column({ name: 'entregador_id', type: 'bigint', unsigned: true })
  entregador_id: string;

  @Index('idx_lotes_status')
  @Column({ type: 'enum', enum: ['em_rota', 'finalizado'], default: 'em_rota' })
  status: StatusLote;

  @Column({ name: 'qtd_pedidos', type: 'int', unsigned: true, default: 0 })
  qtd_pedidos: number;

  @CreateDateColumn({ name: 'iniciado_em', type: 'timestamp' })
  iniciado_em: Date;

  @Column({ name: 'finalizado_em', type: 'timestamp', nullable: true })
  finalizado_em: Date | null;

  @Column({ name: 'lat_partida', type: 'decimal', precision: 10, scale: 7, nullable: true })
  lat_partida: string | null;

  @Column({ name: 'lng_partida', type: 'decimal', precision: 10, scale: 7, nullable: true })
  lng_partida: string | null;

  @ManyToOne(() => Usuario, (usuario) => usuario.lotes)
  @JoinColumn({ name: 'entregador_id' })
  entregador: Usuario;

  @OneToMany(() => LotePedido, (lp) => lp.lote)
  itens: LotePedido[];
}
