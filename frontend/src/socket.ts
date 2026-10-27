import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3000';

let socket: Socket | null = null;

/**
 * Conexão (única) com o namespace /realtime.
 *
 * O token vai como FUNÇÃO, não como valor: o socket.io reavalia `auth` a cada
 * (re)conexão. Se fosse um valor lido uma vez, a conexão continuaria carregando o
 * token do usuário anterior depois de um logout/login.
 *
 * O servidor de hoje ainda ignora esse campo — a autenticação do handshake está
 * sendo feita agora pelo backend (ver dialogo_front/04). Mandar antes é inofensivo
 * e evita uma janela em que o front quebra assim que a chave virar.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(`${SOCKET_URL}/realtime`, {
      transports: ['websocket'],
      autoConnect: true,
      auth: (cb) => cb({ token: localStorage.getItem('token') }),
    });
  }
  return socket;
}

/**
 * Derruba a conexão no logout.
 *
 * Sem isto o socket sobrevive à troca de usuário: quem entrasse depois herdaria a
 * sessão de tempo real de quem saiu. Hoje isso é invisível (o servidor não checa
 * quem é), mas passa a valer assim que o handshake for autenticado.
 */
export function desconectarSocket() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}

/** Entra nas rooms conforme o perfil do usuário logado. */
export function subscribe(perfil: string, entregadorId?: string) {
  getSocket().emit('subscribe', { perfil, entregadorId });
}
