/**
 * Seed de usuários de teste (um por perfil).
 * Rode com: npm run seed
 *
 * Usa as mesmas variáveis de ambiente do .env. O banco já deve existir
 * (criado por db/schema.sql). Este script apenas insere/atualiza usuários
 * com senha_hash gerada por bcrypt.
 *
 * Credenciais criadas (troque em produção!):
 *   admin@entrega-agua.local      / admin123     (admin)
 *   atendente@entrega-agua.local  / atendente123 (atendente)
 *   entregador@entrega-agua.local / entregador123(entregador)
 */
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import {
  Usuario,
  Cliente,
  Produto,
  Pedido,
  PedidoItem,
  LoteEntrega,
  LotePedido,
  Auditoria,
} from './entities';

dotenv.config();

const ds = new DataSource({
  type: 'mysql',
  host: process.env.DB_HOST ?? 'localhost',
  port: parseInt(process.env.DB_PORT ?? '3306', 10),
  username: process.env.DB_USER ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'entrega_fila_agua',
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
  synchronize: false,
});

const contas: Array<{
  nome: string;
  email: string;
  senha: string;
  perfil: 'admin' | 'atendente' | 'entregador';
}> = [
  { nome: 'Administrador', email: 'admin@entrega-agua.local', senha: 'admin123', perfil: 'admin' },
  { nome: 'Atendente Teste', email: 'atendente@entrega-agua.local', senha: 'atendente123', perfil: 'atendente' },
  { nome: 'Entregador Teste', email: 'entregador@entrega-agua.local', senha: 'entregador123', perfil: 'entregador' },
];

async function main() {
  await ds.initialize();
  const repo = ds.getRepository(Usuario);

  for (const c of contas) {
    const senha_hash = await bcrypt.hash(c.senha, 10);
    const existente = await repo.findOne({ where: { email: c.email } });
    if (existente) {
      existente.nome = c.nome;
      existente.senha_hash = senha_hash;
      existente.perfil = c.perfil;
      existente.ativo = 1;
      await repo.save(existente);
      console.log(`atualizado: ${c.email} (${c.perfil})`);
    } else {
      await repo.save(
        repo.create({
          nome: c.nome,
          email: c.email,
          senha_hash,
          perfil: c.perfil,
          ativo: 1,
        }),
      );
      console.log(`criado: ${c.email} (${c.perfil}) senha: ${c.senha}`);
    }
  }

  await ds.destroy();
  console.log('Seed concluído.');
}

main().catch((err) => {
  console.error('Erro no seed:', err);
  process.exit(1);
});
