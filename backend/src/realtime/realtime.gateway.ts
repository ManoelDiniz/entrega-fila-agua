import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { JwtUser } from '../auth/current-user.decorator';

/** O socket carrega o usuário autenticado do handshake. */
interface SocketAutenticado extends Socket {
  data: Socket['data'] & { usuario?: JwtUser };
}

/**
 * Gateway Socket.io. Namespace /realtime.
 * Rooms: room:admins, room:atendentes, room:entregador:<id>
 *
 * SEGURANÇA — leia antes de mexer:
 *
 * A identidade vem SEMPRE do JWT do handshake, NUNCA do que o cliente diz.
 * Antes, o `subscribe` recebia `{ perfil }` do cliente e o servidor acreditava:
 * qualquer pessoa com a URL mandava `perfil: 'admin'` e entrava na `room:admins`,
 * passando a ver a operação inteira ao vivo — fila, pedidos, lotes e a posição
 * dos entregadores. Sem login, sem rastro.
 *
 * Agora:
 *   - conexão sem token válido é RECUSADA no handshake;
 *   - o perfil e o id saem do token (`client.data.usuario`);
 *   - o payload do `subscribe` é IGNORADO — ele existe só por compatibilidade;
 *   - um entregador só entra na própria sala, nunca na de outro.
 *
 * O cliente deve conectar assim:
 *   io(`${URL}/realtime`, { auth: { token: <jwt> } })
 *
 * (Também aceitamos o token em `handshake.headers.authorization` como
 * "Bearer …", para clientes que não usam a opção `auth`.)
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: true, credentials: true },
})
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * A autenticação acontece no MIDDLEWARE DO HANDSHAKE, não no handleConnection.
   *
   * A diferença importa: o `handleConnection` roda DEPOIS que o socket já
   * conectou, então rejeitar ali significa "deixar entrar e mandar embora" — o
   * cliente chega a receber o evento `connect`, e qualquer descuido futuro (um
   * `join` antes do `disconnect`, um evento emitido no meio) vira vazamento.
   * No middleware, quem não tem token válido NUNCA conecta.
   */
  afterInit(server: Server) {
    server.use(async (socket, next) => {
      const token = this.tokenDoHandshake(socket);

      if (!token) {
        this.logger.warn('Conexão sem token recusada.');
        return next(new Error('token_ausente'));
      }

      try {
        const usuario = await this.jwt.verifyAsync<JwtUser>(token, {
          secret: this.config.getOrThrow<string>('JWT_SECRET'),
        });
        (socket as SocketAutenticado).data.usuario = usuario;
        return next();
      } catch {
        this.logger.warn('Conexão com token inválido recusada.');
        return next(new Error('token_invalido'));
      }
    });
  }

  /** Só chega aqui quem passou pelo middleware, então o usuário sempre existe. */
  handleConnection(client: SocketAutenticado) {
    const usuario = client.data?.usuario;
    if (!usuario) {
      // Defesa em profundidade: não deveria acontecer.
      client.disconnect(true);
      return;
    }

    this.entrarNasSalas(client, usuario);
    this.logger.log(`Socket conectado: ${usuario.email} (${usuario.perfil}).`);
  }

  handleDisconnect(client: SocketAutenticado) {
    const usuario = client.data?.usuario;
    if (usuario) this.logger.log(`Socket desconectado: ${usuario.email}.`);
  }

  /**
   * Mantido por compatibilidade com o cliente atual, que ainda emite `subscribe`.
   * O PAYLOAD É IGNORADO de propósito: as salas já foram decididas no handshake,
   * a partir do token. Aceitar `{ perfil }` daqui seria reabrir o buraco.
   */
  @SubscribeMessage('subscribe')
  onSubscribe(@ConnectedSocket() client: SocketAutenticado) {
    const usuario = client.data?.usuario;
    if (!usuario) return { ok: false };

    this.entrarNasSalas(client, usuario);
    return { ok: true, perfil: usuario.perfil };
  }

  /**
   * Posição do entregador em rota.
   * O id vem do TOKEN, não do payload — senão um entregador poderia se passar por
   * outro e poluir o mapa do admin.
   */
  @SubscribeMessage('entregador:posicao:update')
  onPosicao(
    @ConnectedSocket() client: SocketAutenticado,
    @MessageBody() data: { lat: number; lng: number },
  ) {
    const usuario = client.data?.usuario;
    if (!usuario || usuario.perfil !== 'entregador') return { ok: false };

    this.server.to('room:admins').emit('entregador:posicao', {
      entregadorId: usuario.sub,
      nome: usuario.nome,
      lat: data?.lat,
      lng: data?.lng,
    });
    return { ok: true };
  }

  /** Salas derivadas do token. É a única fonte de verdade. */
  private entrarNasSalas(client: SocketAutenticado, usuario: JwtUser) {
    if (usuario.perfil === 'admin') client.join('room:admins');
    if (usuario.perfil === 'atendente') client.join('room:atendentes');
    if (usuario.perfil === 'entregador') {
      // Só a própria sala. Nunca a de outro entregador.
      client.join(`room:entregador:${usuario.sub}`);
    }
  }

  /** Aceita `auth: { token }` (padrão do Socket.io) ou `Authorization: Bearer`. */
  private tokenDoHandshake(client: Socket): string | null {
    const doAuth = client.handshake?.auth?.token;
    if (typeof doAuth === 'string' && doAuth) {
      return doAuth.replace(/^Bearer\s+/i, '');
    }

    const header = client.handshake?.headers?.authorization;
    if (typeof header === 'string' && header) {
      return header.replace(/^Bearer\s+/i, '');
    }

    return null;
  }

  // ---- Helpers usados pelos serviços para emitir eventos ----

  emitFilaAtualizada(payload: unknown) {
    this.server.to('room:admins').emit('fila:atualizada', payload);
    this.server.to('room:atendentes').emit('fila:atualizada', payload);
  }

  emitPedidoNovo(payload: unknown) {
    this.server.to('room:admins').emit('pedido:novo', payload);
    this.server.to('room:atendentes').emit('pedido:novo', payload);
  }

  emitPedidoStatus(payload: unknown) {
    this.server.to('room:admins').emit('pedido:status', payload);
  }

  emitLoteCriado(payload: unknown) {
    this.server.to('room:admins').emit('lote:criado', payload);
  }

  emitLoteRotaPronta(entregadorId: string, payload: unknown) {
    this.server
      .to(`room:entregador:${entregadorId}`)
      .emit('lote:rota_pronta', payload);
  }

  emitLotePedidoEntregue(payload: unknown) {
    this.server.to('room:admins').emit('lote:pedido_entregue', payload);
    this.server.to('room:atendentes').emit('lote:pedido_entregue', payload);
  }

  emitLoteFinalizado(payload: unknown) {
    this.server.to('room:admins').emit('lote:finalizado', payload);
  }

  /** Catálogo mudou: o atendente precisa recarregar antes de vender pelo preço velho. */
  emitProdutoAtualizado(payload: unknown) {
    this.server.to('room:admins').emit('produto:atualizado', payload);
    this.server.to('room:atendentes').emit('produto:atualizado', payload);
  }
}
