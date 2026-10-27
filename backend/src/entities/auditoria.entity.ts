import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Usuario } from './usuario.entity';
import { Pedido } from './pedido.entity';

@Entity('auditoria')
export class Auditoria {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_auditoria_usuario')
  @Column({ name: 'usuario_id', type: 'bigint', unsigned: true, nullable: true })
  usuario_id: string | null;

  @Index('idx_auditoria_pedido')
  @Column({ name: 'pedido_id', type: 'bigint', unsigned: true, nullable: true })
  pedido_id: string | null;

  @Index('idx_auditoria_acao')
  @Column({ type: 'varchar', length: 80 })
  acao: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  detalhe: string | null;

  @Index('idx_auditoria_criado_em')
  @CreateDateColumn({ name: 'criado_em', type: 'timestamp' })
  criado_em: Date;

  @ManyToOne(() => Usuario, (u) => u.auditorias, { nullable: true })
  @JoinColumn({ name: 'usuario_id' })
  usuario: Usuario | null;

  @ManyToOne(() => Pedido, { nullable: true })
  @JoinColumn({ name: 'pedido_id' })
  pedido: Pedido | null;
}
