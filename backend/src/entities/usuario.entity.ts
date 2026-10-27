import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Pedido } from './pedido.entity';
import { LoteEntrega } from './lote-entrega.entity';
import { Auditoria } from './auditoria.entity';

export type PerfilUsuario = 'admin' | 'atendente' | 'entregador';

@Entity('usuarios')
export class Usuario {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 120 })
  nome: string;

  @Index('uq_usuarios_email', { unique: true })
  @Column({ type: 'varchar', length: 160 })
  email: string;

  @Column({ name: 'senha_hash', type: 'varchar', length: 255 })
  senha_hash: string;

  @Column({ type: 'enum', enum: ['admin', 'atendente', 'entregador'] })
  perfil: PerfilUsuario;

  @Column({ type: 'varchar', length: 20, nullable: true })
  telefone: string | null;

  @Column({ type: 'tinyint', width: 1, default: 1 })
  ativo: number;

  @CreateDateColumn({ name: 'criado_em', type: 'timestamp' })
  criado_em: Date;

  @OneToMany(() => Pedido, (pedido) => pedido.atendente)
  pedidosAtendidos: Pedido[];

  @OneToMany(() => LoteEntrega, (lote) => lote.entregador)
  lotes: LoteEntrega[];

  @OneToMany(() => Auditoria, (a) => a.usuario)
  auditorias: Auditoria[];
}
