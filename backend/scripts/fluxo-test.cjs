/**
 * Teste do ciclo de entrega não realizada (roda contra o backend local: `node scripts/<arquivo>.cjs` a partir de `backend/`).
 *
 * Cria os seus próprios dados (cliente + 2 pedidos), exercita o fluxo e LIMPA
 * tudo no fim. Não encosta nos dados reais.
 *
 * Prova:
 *   1. finalizar lote COM pendência -> 400 (antes: passava e prendia o pedido)
 *   2. "não entregue" com motivo -> pedido VOLTA PARA A FILA e sai do lote
 *   3. finalizar depois de resolver tudo -> 200
 *   4. o pedido devolvido pode ser puxado por OUTRO lote (UNIQUE liberada)
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const API = 'http://localhost:3000/api';
let db;

const login = async (email, senha) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });
  return (await r.json()).token;
};

const call = async (metodo, rota, token, body) => {
  const r = await fetch(`${API}${rota}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};

const statusPedido = async (id) => {
  const [r] = await db.query('SELECT status FROM pedidos WHERE id = ?', [id]);
  return r[0]?.status;
};
const estaNumLote = async (id) => {
  const [r] = await db.query('SELECT 1 FROM lote_pedidos WHERE pedido_id = ?', [id]);
  return r.length > 0;
};

(async () => {
  db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: +process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const tAtend = await login('atendente@entrega-agua.local', 'atendente123');
  const tEntreg = await login('entregador@entrega-agua.local', 'entregador123');

  // --- monta cenário isolado ---
  const [cli] = await db.query(
    `INSERT INTO clientes (nome, endereco, lat, lng) VALUES
       ('ZZTESTE Cliente', 'Rua de Teste, 1', -3.7350, -38.5230)`,
  );
  const clienteId = cli.insertId;

  const pedidos = [];
  for (let i = 0; i < 2; i++) {
    const { corpo } = await call('POST', '/pedidos', tAtend, {
      cliente_id: String(clienteId),
      itens: [{ produto_id: '1', quantidade: 1 }],
      observacao: 'ZZTESTE',
    });
    pedidos.push(corpo.id);
  }
  console.log(`cenario: cliente ${clienteId}, pedidos ${pedidos.join(', ')}\n`);

  // --- puxa o lote ---
  const { corpo: lote } = await call('POST', '/lotes', tEntreg, {
    qtd: 2,
    lat: -3.7327,
    lng: -38.5267,
  });
  console.log(`lote ${lote.id} puxado com ${lote.itens.length} parada(s)\n`);

  // --- 1. finalizar com pendencia deve FALHAR ---
  const f1 = await call('PATCH', `/lotes/${lote.id}/finalizar`, tEntreg);
  console.log('1) finalizar COM 2 pendencias');
  console.log(`   HTTP ${f1.status} ${f1.status === 400 ? 'OK: recusado' : 'FALHA: passou!'}`);
  console.log(`   "${f1.corpo?.message}"\n`);

  // --- 2. entrega uma, nao entrega a outra ---
  const [entregue, devolvido] = pedidos;
  await call('PATCH', `/lotes/${lote.id}/pedidos/${entregue}/entregue`, tEntreg);

  const ne = await call(
    'PATCH', `/lotes/${lote.id}/pedidos/${devolvido}/nao-entregue`, tEntreg,
    { motivo: 'cliente_ausente', observacao: 'tocou 3x, ninguem atendeu' },
  );
  console.log('2) marcar "nao entregue" (cliente_ausente)');
  console.log(`   HTTP ${ne.status}`);
  console.log(`   pedido ${devolvido}: status = "${await statusPedido(devolvido)}" ` +
    `${(await statusPedido(devolvido)) === 'na_fila' ? 'OK: VOLTOU PRA FILA' : 'FALHA'}`);
  console.log(`   ainda vinculado ao lote? ${await estaNumLote(devolvido) ? 'FALHA: sim (preso!)' : 'OK: nao (liberado)'}\n`);

  // --- 3. finalizar agora deve PASSAR ---
  const f2 = await call('PATCH', `/lotes/${lote.id}/finalizar`, tEntreg);
  console.log('3) finalizar depois de resolver tudo');
  console.log(`   HTTP ${f2.status} ${f2.status === 200 ? 'OK: finalizado' : 'FALHA'}\n`);

  // --- 4. o pedido devolvido pode ser puxado de novo? ---
  const { status, corpo: lote2 } = await call('POST', '/lotes', tEntreg, {
    qtd: 1, lat: -3.7327, lng: -38.5267,
  });
  console.log('4) o pedido devolvido pode entrar em OUTRO lote?');
  if (status === 201 && lote2.itens?.some((i) => i.pedido_id === devolvido)) {
    console.log(`   OK: pedido ${devolvido} foi puxado no lote ${lote2.id} (UNIQUE liberada)`);
  } else {
    console.log(`   FALHA: nao foi repuxado (HTTP ${status})`);
  }

  // --- limpeza ---
  console.log('\n--- limpando o cenario de teste ---');
  await db.query('DELETE FROM lote_pedidos WHERE pedido_id IN (?, ?)', pedidos);
  await db.query('DELETE FROM auditoria WHERE pedido_id IN (?, ?)', pedidos);
  await db.query('DELETE FROM pedido_itens WHERE pedido_id IN (?, ?)', pedidos);
  await db.query('DELETE FROM pedidos WHERE id IN (?, ?)', pedidos);
  await db.query('DELETE FROM lotes_entrega WHERE id IN (?, ?)', [lote.id, lote2?.id ?? 0]);
  await db.query('DELETE FROM clientes WHERE id = ?', [clienteId]);
  const [p] = await db.query("SELECT COUNT(*) n FROM pedidos WHERE observacao = 'ZZTESTE'");
  const [c] = await db.query("SELECT COUNT(*) n FROM clientes WHERE nome LIKE 'ZZTESTE%'");
  console.log(`sobrou: ${p[0].n} pedido(s) e ${c[0].n} cliente(s) de teste (esperado: 0 e 0)`);

  await db.end();
  process.exit(0);
})();
