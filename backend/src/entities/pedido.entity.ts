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
import { Cliente } from './cliente.entity';
import { Usuario } from './usuario.entity';
import { PedidoItem } from './pedido-item.entity';

export type StatusPedido =
  | 'na_fila'
  | 'atribuido'
  | 'em_rota'
  | 'entregue'
  | 'cancelado';

export type PrioridadePedido = 'normal' | 'vip' | 'urgente';

@Entity('pedidos')
// Índice composto que serve a query da fila
// (WHERE status='na_fila' ORDER BY prioridade, criado_em)
@Index('idx_pedidos_fila', ['status', 'prioridade', 'criado_em'])
export class Pedido {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_pedidos_cliente')
  @Column({ name: 'cliente_id', type: 'bigint', unsigned: true })
  cliente_id: string;

  @Index('idx_pedidos_atendente')
  @Column({ name: 'atendente_id', type: 'bigint', unsigned: true, nullable: true })
  atendente_id: string | null;

  @Index('idx_pedidos_status')
  @Column({
    type: 'enum',
    enum: ['na_fila', 'atribuido', 'em_rota', 'entregue', 'cancelado'],
    default: 'na_fila',
  })
  status: StatusPedido;

  @Index('idx_pedidos_prioridade')
  @Column({
    type: 'enum',
    enum: ['normal', 'vip', 'urgente'],
    default: 'normal',
  })
  prioridade: PrioridadePedido;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lat: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 7, nullable: true })
  lng: string | null;

  @Column({
    name: 'valor_total',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
  })
  valor_total: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  observacao: string | null;

  @Index('idx_pedidos_criado_em')
  @CreateDateColumn({ name: 'criado_em', type: 'timestamp' })
  criado_em: Date;

  @Column({ name: 'entregue_em', type: 'timestamp', nullable: true })
  entregue_em: Date | null;

  @ManyToOne(() => Cliente, (cliente) => cliente.pedidos)
  @JoinColumn({ name: 'cliente_id' })
  cliente: Cliente;

  @ManyToOne(() => Usuario, (usuario) => usuario.pedidosAtendidos, {
    nullable: true,
  })
  @JoinColumn({ name: 'atendente_id' })
  atendente: Usuario | null;

  @OneToMany(() => PedidoItem, (item) => item.pedido)
  itens: PedidoItem[];
}
