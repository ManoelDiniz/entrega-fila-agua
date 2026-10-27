import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Pedido } from './pedido.entity';
import { Produto } from './produto.entity';

@Entity('pedido_itens')
export class PedidoItem {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Index('idx_pedido_itens_pedido')
  @Column({ name: 'pedido_id', type: 'bigint', unsigned: true })
  pedido_id: string;

  @Index('idx_pedido_itens_produto')
  @Column({ name: 'produto_id', type: 'bigint', unsigned: true })
  produto_id: string;

  @Column({ type: 'int', unsigned: true, default: 1 })
  quantidade: number;

  @Column({
    name: 'preco_unit',
    type: 'decimal',
    precision: 10,
    scale: 2,
    default: 0.0,
  })
  preco_unit: string;

  @ManyToOne(() => Pedido, (pedido) => pedido.itens)
  @JoinColumn({ name: 'pedido_id' })
  pedido: Pedido;

  @ManyToOne(() => Produto, (produto) => produto.itens)
  @JoinColumn({ name: 'produto_id' })
  produto: Produto;
}
