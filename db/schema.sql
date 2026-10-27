-- =====================================================================
--  Sistema de Controle de Entrega por Fila - Entregadora de Água
--  Schema MySQL 8.0 (compatível também com MariaDB 10.5+)
--  Charset: utf8mb4 / Collation: utf8mb4_unicode_ci
-- =====================================================================
--  Como rodar (Windows PowerShell):
--    Get-Content schema.sql | mysql -u root -p
--  Verificar:
--    mysql -u root -p -e "USE entrega_fila_agua; SHOW TABLES;"
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Banco de dados
-- ---------------------------------------------------------------------
CREATE DATABASE IF NOT EXISTS entrega_fila_agua
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE entrega_fila_agua;

-- Recria as tabelas do zero (ordem inversa das FKs)
DROP TABLE IF EXISTS auditoria;
DROP TABLE IF EXISTS lote_pedidos;
DROP TABLE IF EXISTS lotes_entrega;
DROP TABLE IF EXISTS pedido_itens;
DROP TABLE IF EXISTS pedidos;
DROP TABLE IF EXISTS produtos;
DROP TABLE IF EXISTS clientes;
DROP TABLE IF EXISTS usuarios;

-- ---------------------------------------------------------------------
-- 2) usuarios
-- ---------------------------------------------------------------------
CREATE TABLE usuarios (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome         VARCHAR(120)    NOT NULL,
  email        VARCHAR(160)    NOT NULL,
  senha_hash   VARCHAR(255)    NOT NULL,
  perfil       ENUM('admin','atendente','entregador') NOT NULL,
  telefone     VARCHAR(20)     NULL,
  ativo        TINYINT(1)      NOT NULL DEFAULT 1,
  criado_em    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_email (email),
  KEY idx_usuarios_perfil (perfil),
  KEY idx_usuarios_ativo (ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 3) clientes
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome         VARCHAR(120)    NOT NULL,
  telefone     VARCHAR(20)     NULL,
  endereco     VARCHAR(255)    NOT NULL,
  lat          DECIMAL(10,7)   NULL,
  lng          DECIMAL(10,7)   NULL,
  referencia   VARCHAR(255)    NULL,
  criado_em    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_clientes_nome (nome),
  KEY idx_clientes_telefone (telefone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 4) produtos  (somente ÁGUA por enquanto)
-- ---------------------------------------------------------------------
CREATE TABLE produtos (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nome         VARCHAR(120)    NOT NULL,
  preco        DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
  ativo        TINYINT(1)      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY idx_produtos_ativo (ativo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 5) pedidos
--    A "fila" NÃO é uma tabela: é a query sobre pedidos com
--    status = 'na_fila' ordenada por prioridade e criado_em.
-- ---------------------------------------------------------------------
CREATE TABLE pedidos (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cliente_id   BIGINT UNSIGNED NOT NULL,
  atendente_id BIGINT UNSIGNED NULL,
  status       ENUM('na_fila','atribuido','em_rota','entregue','cancelado')
               NOT NULL DEFAULT 'na_fila',
  prioridade   ENUM('normal','vip','urgente') NOT NULL DEFAULT 'normal',
  lat          DECIMAL(10,7)   NULL,
  lng          DECIMAL(10,7)   NULL,
  valor_total  DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
  observacao   VARCHAR(500)    NULL,
  criado_em    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  entregue_em  TIMESTAMP       NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_pedidos_cliente (cliente_id),
  KEY idx_pedidos_atendente (atendente_id),
  KEY idx_pedidos_status (status),
  KEY idx_pedidos_prioridade (prioridade),
  KEY idx_pedidos_criado_em (criado_em),
  -- Índice composto que serve exatamente a ordenação da fila:
  --   WHERE status='na_fila' ORDER BY prioridade, criado_em
  KEY idx_pedidos_fila (status, prioridade, criado_em),
  CONSTRAINT fk_pedidos_cliente
    FOREIGN KEY (cliente_id)   REFERENCES clientes (id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_pedidos_atendente
    FOREIGN KEY (atendente_id) REFERENCES usuarios (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 6) pedido_itens
-- ---------------------------------------------------------------------
CREATE TABLE pedido_itens (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pedido_id    BIGINT UNSIGNED NOT NULL,
  produto_id   BIGINT UNSIGNED NOT NULL,
  quantidade   INT UNSIGNED    NOT NULL DEFAULT 1,
  preco_unit   DECIMAL(10,2)   NOT NULL DEFAULT 0.00,
  PRIMARY KEY (id),
  KEY idx_pedido_itens_pedido (pedido_id),
  KEY idx_pedido_itens_produto (produto_id),
  CONSTRAINT fk_itens_pedido
    FOREIGN KEY (pedido_id)  REFERENCES pedidos (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_itens_produto
    FOREIGN KEY (produto_id) REFERENCES produtos (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 7) lotes_entrega  (lote que o entregador puxa da fila)
-- ---------------------------------------------------------------------
CREATE TABLE lotes_entrega (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entregador_id  BIGINT UNSIGNED NOT NULL,
  status         ENUM('em_rota','finalizado') NOT NULL DEFAULT 'em_rota',
  qtd_pedidos    INT UNSIGNED    NOT NULL DEFAULT 0,
  iniciado_em    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finalizado_em  TIMESTAMP       NULL DEFAULT NULL,
  lat_partida    DECIMAL(10,7)   NULL,
  lng_partida    DECIMAL(10,7)   NULL,
  PRIMARY KEY (id),
  KEY idx_lotes_entregador (entregador_id),
  KEY idx_lotes_status (status),
  CONSTRAINT fk_lotes_entregador
    FOREIGN KEY (entregador_id) REFERENCES usuarios (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 8) lote_pedidos  (sequência otimizada de rota dentro do lote)
-- ---------------------------------------------------------------------
CREATE TABLE lote_pedidos (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lote_id      BIGINT UNSIGNED NOT NULL,
  pedido_id    BIGINT UNSIGNED NOT NULL,
  sequencia    INT UNSIGNED    NOT NULL,
  distancia_m  INT UNSIGNED    NULL,
  tempo_seg    INT UNSIGNED    NULL,
  entregue_em  TIMESTAMP       NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lote_pedido (lote_id, pedido_id),
  UNIQUE KEY uq_lote_sequencia (lote_id, sequencia),
  -- Um pedido só pode estar em um lote por vez (garante integridade da fila)
  UNIQUE KEY uq_pedido_unico (pedido_id),
  KEY idx_lote_pedidos_lote (lote_id),
  CONSTRAINT fk_lp_lote
    FOREIGN KEY (lote_id)   REFERENCES lotes_entrega (id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_lp_pedido
    FOREIGN KEY (pedido_id) REFERENCES pedidos (id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 9) auditoria
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id   BIGINT UNSIGNED NULL,
  pedido_id    BIGINT UNSIGNED NULL,
  acao         VARCHAR(80)     NOT NULL,
  detalhe      VARCHAR(500)    NULL,
  criado_em    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_auditoria_usuario (usuario_id),
  KEY idx_auditoria_pedido (pedido_id),
  KEY idx_auditoria_acao (acao),
  KEY idx_auditoria_criado_em (criado_em),
  CONSTRAINT fk_auditoria_usuario
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_auditoria_pedido
    FOREIGN KEY (pedido_id)  REFERENCES pedidos (id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
--  SEED INICIAL
-- =====================================================================

-- Produto: somente ÁGUA por enquanto
INSERT INTO produtos (nome, preco, ativo) VALUES
  ('Galão de Água 20L', 12.00, 1),
  ('Galão de Água 10L',  8.00, 1);

-- ---------------------------------------------------------------------
--  USUÁRIOS: NÃO são semeados aqui. Rode `npm run seed` no backend.
-- ---------------------------------------------------------------------
--  Este arquivo já inseriu um admin com um "hash de exemplo" que NÃO era um
--  bcrypt válido — o usuário existia, mas era IMPOSSÍVEL logar com ele, e o
--  erro só aparecia na tela de login, como "credenciais inválidas".
--
--  Senha nenhuma pode ser gerada em SQL: o hash bcrypt precisa do algoritmo.
--  Por isso os usuários têm UMA fonte só, o `backend/src/seed.ts`, que:
--    - gera bcrypt de verdade;
--    - é idempotente (faz upsert por e-mail, pode rodar quantas vezes quiser);
--    - cria as três contas de teste, uma por perfil.
--
--    cd backend && npm run seed
-- ---------------------------------------------------------------------

-- =====================================================================
--  FIM
-- =====================================================================
