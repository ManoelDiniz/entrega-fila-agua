import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import {
  Usuario,
  Cliente,
  Produto,
  Pedido,
  PedidoItem,
  LoteEntrega,
  LotePedido,
  Auditoria,
} from '../entities';

/**
 * Configuração do TypeORM lida a partir das variáveis de ambiente (.env).
 * IMPORTANTE: synchronize=false. O banco já foi criado pelo db/schema.sql.
 * O TypeORM NÃO deve criar/alterar tabelas — apenas se conectar ao schema
 * existente.
 */
export function buildTypeOrmOptions(
  config: ConfigService,
): TypeOrmModuleOptions {
  return {
    type: 'mysql',
    host: config.get<string>('DB_HOST', 'localhost'),
    port: parseInt(config.get<string>('DB_PORT', '3306'), 10),
    username: config.get<string>('DB_USER', 'root'),
    password: config.get<string>('DB_PASSWORD', ''),
    database: config.get<string>('DB_NAME', 'entrega_fila_agua'),
    charset: 'utf8mb4',
    entities: [
      Usuario,
      Cliente,
      Produto,
      Pedido,
      PedidoItem,
      LoteEntrega,
      LotePedido,
      Auditoria,
    ],
    // NUNCA true: o schema é gerenciado pelo db/schema.sql.
    synchronize: false,
    logging: ['error'],
  };
}
