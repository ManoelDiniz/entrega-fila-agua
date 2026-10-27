/**
 * Teste de segurança do Socket.io (roda contra o backend local: `node scripts/<arquivo>.cjs` a partir de `backend/`).
 *
 * Prova três coisas:
 *   1. conexão SEM token é recusada;
 *   2. conexão com token INVÁLIDO é recusada;
 *   3. um ENTREGADOR autenticado NÃO consegue entrar na room:admins mandando
 *      `subscribe { perfil: 'admin' }` — que era o buraco.
 */
require('dotenv').config();
const { io } = require('socket.io-client');

const URL = 'http://localhost:3000/realtime';
const API = 'http://localhost:3000/api';

const login = async (email, senha) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });
  return (await r.json()).token;
};

/** Conecta e resolve com o que aconteceu. */
const conectar = (auth) =>
  new Promise((resolve) => {
    const s = io(URL, { transports: ['websocket'], auth, forceNew: true });
    const fim = (r) => {
      s.close();
      resolve(r);
    };
    s.on('connect', () => fim({ conectou: true, socket: s }));
    s.on('auth:erro', (e) => fim({ conectou: false, motivo: e.motivo }));
    s.on('connect_error', (e) => fim({ conectou: false, motivo: e.message }));
    setTimeout(() => fim({ conectou: false, motivo: 'timeout' }), 5000);
  });

(async () => {
  console.log('1) conexao SEM token');
  const a = await conectar(undefined);
  console.log(`   ${a.conectou ? 'FALHA: conectou!' : 'OK: recusado (' + a.motivo + ')'}`);

  console.log('\n2) conexao com token INVALIDO');
  const b = await conectar({ token: 'nao.eh.um.jwt' });
  console.log(`   ${b.conectou ? 'FALHA: conectou!' : 'OK: recusado (' + b.motivo + ')'}`);

  console.log('\n3) ENTREGADOR tentando se passar por ADMIN');
  const tokenEntregador = await login('entregador@entrega-agua.local', 'entregador123');

  await new Promise((resolve) => {
    const s = io(URL, {
      transports: ['websocket'],
      auth: { token: tokenEntregador },
      forceNew: true,
    });

    s.on('connect', () => {
      console.log('   conectou (esperado: ele TEM login valido)');
      // O ataque: mentir o perfil no subscribe.
      s.emit('subscribe', { perfil: 'admin', entregadorId: '3' }, (resp) => {
        console.log(`   subscribe {perfil:'admin'} -> servidor respondeu perfil='${resp?.perfil}'`);
        if (resp?.perfil === 'admin') {
          console.log("   FALHA: o servidor acreditou no perfil que o cliente mandou!");
        } else {
          console.log("   OK: o servidor IGNOROU o payload e usou o perfil do token.");
        }

        // Prova final: ele recebe evento destinado ao admin?
        let vazou = false;
        s.on('lote:criado', () => { vazou = true; });
        s.on('produto:atualizado', () => { vazou = true; });

        // Dispara um evento que SÓ vai para room:admins e room:atendentes.
        fetch(`${API}/produtos`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenEntregador}`,
          },
          body: JSON.stringify({ nome: 'TESTE socket', preco: 1 }),
        }).catch(() => {});

        setTimeout(() => {
          console.log(
            vazou
              ? '   FALHA: o entregador RECEBEU evento de admin (vazou).'
              : '   OK: o entregador NAO recebeu evento de admin.',
          );
          s.close();
          resolve();
        }, 1500);
      });
    });

    s.on('connect_error', (e) => {
      console.log(`   FALHA inesperada: entregador legitimo recusado (${e.message})`);
      resolve();
    });
  });

  process.exit(0);
})();
