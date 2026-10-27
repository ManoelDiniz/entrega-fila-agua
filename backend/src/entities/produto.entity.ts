import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PedidoItem } from './pedido-item.entity';

@Entity('produtos')
export class Produto {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'varchar', length: 120 })
  nome: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0.0 })
  preco: string;

  @Column({ type: 'tinyint', width: 1, default: 1 })
  ativo: number;

  @OneToMany(() => PedidoItem, (item) => item.produto)
  itens: PedidoItem[];
}
