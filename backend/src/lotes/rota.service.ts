import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pedido } from '../entities/pedido.entity';

export interface PontoPartida {
  lat: number;
  lng: number;
}

export interface RotaItem {
  pedido_id: string;
  sequencia: number;
  /** Distância do trecho que CHEGA neste ponto (metros). */
  distancia_m: number | null;
  /** Tempo do trecho que CHEGA neste ponto (segundos). */
  tempo_seg: number | null;
}

export type FonteRota = 'osrm' | 'google' | 'haversine' | 'sem_coordenadas';

export interface RotaResultado {
  itens: RotaItem[];
  /** true quando a ordem veio de um roteador real (malha viária), não de estimativa. */
  otimizada: boolean;
  fonte: FonteRota;
  distancia_total_m: number | null;
  tempo_total_seg: number | null;
  /** Pedidos que ficaram de fora da otimização por não terem lat/lng. */
  sem_coordenadas: string[];
}

interface Coord {
  lat: number;
  lng: number;
}

/** Um pedido que tem coordenadas válidas — só esses podem ser roteados. */
interface Parada {
  pedido_id: string;
  coord: Coord;
}

/**
 * Orquestrador de rota: transforma {ponto de partida + pedidos} numa sequência
 * ordenada de paradas, com distância e tempo por trecho.
 *
 * Provedores (ROTA_PROVIDER):
 *   - osrm (padrão) — servidor OSRM, gratuito e sem chave. Usa o serviço /trip,
 *     que resolve o caixeiro-viajante (ordem ótima das paradas) sobre a malha
 *     viária real. NÃO considera trânsito ao vivo: usa velocidades estáticas.
 *   - google — Routes API (computeRoutes) com optimizeWaypointOrder e
 *     TRAFFIC_AWARE. Exige GOOGLE_MAPS_API_KEY e billing ativo.
 *
 * Em qualquer falha (servidor fora do ar, timeout, resposta inesperada) cai no
 * fallback Haversine: vizinho-mais-próximo em linha reta. A rota sai pior, mas a
 * operação não trava — e `fonte` registra que foi estimativa.
 *
 * Pedidos sem lat/lng não podem ser roteados: vão para o fim da sequência, com
 * distância/tempo nulos, e são listados em `sem_coordenadas`.
 */
@Injectable()
export class RotaService {
  private readonly logger = new Logger(RotaService.name);

  constructor(private readonly config: ConfigService) {}

  async otimizar(
    partida: PontoPartida,
    pedidos: Pedido[],
  ): Promise<RotaResultado> {
    const paradas: Parada[] = [];
    const semCoordenadas: string[] = [];

    for (const p of pedidos) {
      const coord = this.coordDoPedido(p);
      if (coord) paradas.push({ pedido_id: p.id, coord });
      else semCoordenadas.push(p.id);
    }

    if (semCoordenadas.length) {
      this.logger.warn(
        `${semCoordenadas.length} pedido(s) sem lat/lng ficaram fora da ` +
          `otimização: ${semCoordenadas.join(', ')}. Geocodifique os clientes.`,
      );
    }

    if (paradas.length === 0) {
      // Nada a rotear: mantém a ordem da fila.
      return {
        itens: semCoordenadas.map((pedido_id, idx) => ({
          pedido_id,
          sequencia: idx + 1,
          distancia_m: null,
          tempo_seg: null,
        })),
        otimizada: false,
        fonte: 'sem_coordenadas',
        distancia_total_m: null,
        tempo_total_seg: null,
        sem_coordenadas: semCoordenadas,
      };
    }

    const provedor = this.config.get<string>('ROTA_PROVIDER', 'osrm');
    const chaveGoogle = this.config.get<string>('GOOGLE_MAPS_API_KEY');

    let rota: Omit<RotaResultado, 'sem_coordenadas'> | null = null;

    if (provedor === 'google' && chaveGoogle) {
      rota = await this.viaGoogle(partida, paradas, chaveGoogle);
      if (!rota) this.logger.warn('Google Routes falhou; caindo no Haversine.');
    } else {
      rota = await this.viaOsrm(partida, paradas);
      if (!rota) this.logger.warn('OSRM falhou; caindo no Haversine.');
    }

    const resolvida = rota ?? this.viaHaversine(partida, paradas);

    // Pedidos sem coordenadas entram no fim, preservando a ordem da fila.
    const itens = [...resolvida.itens];
    semCoordenadas.forEach((pedido_id, i) => {
      itens.push({
        pedido_id,
        sequencia: resolvida.itens.length + i + 1,
        distancia_m: null,
        tempo_seg: null,
      });
    });

    return { ...resolvida, itens, sem_coordenadas: semCoordenadas };
  }

  /**
   * OSRM — serviço /trip (caixeiro-viajante).
   *
   * Envia [partida, ...paradas] com `source=first` (a rota começa no GPS do
   * entregador), `roundtrip=false` e `destination=any` (não há retorno ao
   * depósito; a última parada é escolhida pelo próprio otimizador).
   *
   * ATENÇÃO à ordem das coordenadas: o OSRM usa lon,lat — o inverso do resto do
   * sistema.
   *
   * A resposta traz `waypoints[]` na ordem em que foram ENVIADOS, cada um com
   * `waypoint_index` = a posição que aquele ponto ocupa na rota otimizada. E
   * `trips[0].legs[k]` é o trecho que liga a posição k à posição k+1 — ou seja,
   * o trecho que CHEGA na posição k+1.
   */
  private async viaOsrm(
    partida: PontoPartida,
    paradas: Parada[],
  ): Promise<Omit<RotaResultado, 'sem_coordenadas'> | null> {
    const base = this.config.get<string>(
      'OSRM_URL',
      'https://router.project-osrm.org',
    );

    const pontos = [partida, ...paradas.map((p) => p.coord)];
    const coords = pontos.map((c) => `${c.lng},${c.lat}`).join(';');

    const url = new URL(`${base}/trip/v1/driving/${coords}`);
    url.searchParams.set('source', 'first');
    url.searchParams.set('destination', 'any');
    url.searchParams.set('roundtrip', 'false');
    url.searchParams.set('overview', 'false');

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) {
        this.logger.warn(`OSRM respondeu ${resp.status}.`);
        return null;
      }

      const dados = (await resp.json()) as {
        code: string;
        trips?: Array<{
          distance: number;
          duration: number;
          legs: Array<{ distance: number; duration: number }>;
        }>;
        waypoints?: Array<{ waypoint_index: number }>;
      };

      if (dados.code !== 'Ok' || !dados.trips?.length || !dados.waypoints) {
        this.logger.warn(`OSRM retornou code=${dados.code}.`);
        return null;
      }

      const trip = dados.trips[0];
      const waypoints = dados.waypoints;

      // waypoints[0] = partida; waypoints[i+1] = paradas[i] (mesma ordem do envio).
      const porPosicao = new Map<number, Parada>();
      paradas.forEach((parada, i) => {
        const posicao = waypoints[i + 1]?.waypoint_index;
        if (posicao != null) porPosicao.set(posicao, parada);
      });

      const itens: RotaItem[] = [];
      // Posições 1..n — a posição 0 é a partida do entregador, não é entrega.
      for (let posicao = 1; posicao <= paradas.length; posicao++) {
        const parada = porPosicao.get(posicao);
        if (!parada) {
          this.logger.warn('OSRM devolveu sequência incompleta; usando fallback.');
          return null;
        }
        const trecho = trip.legs[posicao - 1];
        itens.push({
          pedido_id: parada.pedido_id,
          sequencia: posicao,
          distancia_m: trecho ? Math.round(trecho.distance) : null,
          tempo_seg: trecho ? Math.round(trecho.duration) : null,
        });
      }

      return {
        itens,
        otimizada: true,
        fonte: 'osrm',
        distancia_total_m: Math.round(trip.distance),
        tempo_total_seg: Math.round(trip.duration),
      };
    } catch (erro) {
      this.logger.warn(`Falha ao chamar o OSRM: ${erro}`);
      return null;
    }
  }

  /**
   * Google Routes API (computeRoutes) com optimizeWaypointOrder + TRAFFIC_AWARE.
   * Só roda com ROTA_PROVIDER=google e GOOGLE_MAPS_API_KEY preenchida.
   *
   * A API reordena apenas os `intermediates`, mantendo origin e destination
   * fixos. Como não há depósito de retorno, elegemos como destino a parada mais
   * distante da partida (heurística) e o resto vira intermediate.
   *
   * NOTA: este caminho não foi exercitado — não há chave da Google neste
   * ambiente. O caminho testado, e o padrão, é o OSRM.
   */
  private async viaGoogle(
    partida: PontoPartida,
    paradas: Parada[],
    chave: string,
  ): Promise<Omit<RotaResultado, 'sem_coordenadas'> | null> {
    if (paradas.length > 25) {
      this.logger.warn(
        'A Routes API otimiza no máximo 25 waypoints; usando fallback.',
      );
      return null;
    }

    // Uma parada só: não há ordem a otimizar.
    if (paradas.length === 1) return this.viaHaversine(partida, paradas);

    let idxFinal = 0;
    let maiorDist = -1;
    paradas.forEach((p, i) => {
      const d = distanciaHaversineM(partida, p.coord);
      if (d > maiorDist) {
        maiorDist = d;
        idxFinal = i;
      }
    });

    const destino = paradas[idxFinal];
    const intermediarios = paradas.filter((_, i) => i !== idxFinal);

    const ponto = (c: Coord) => ({
      location: { latLng: { latitude: c.lat, longitude: c.lng } },
    });

    try {
      const resp = await fetch(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': chave,
            'X-Goog-FieldMask': [
              'routes.optimizedIntermediateWaypointIndex',
              'routes.legs.distanceMeters',
              'routes.legs.duration',
              'routes.distanceMeters',
              'routes.duration',
            ].join(','),
          },
          body: JSON.stringify({
            origin: ponto(partida),
            destination: ponto(destino.coord),
            intermediates: intermediarios.map((p) => ponto(p.coord)),
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
            optimizeWaypointOrder: true,
            languageCode: 'pt-BR',
            units: 'METRIC',
          }),
          signal: AbortSignal.timeout(15_000),
        },
      );

      if (!resp.ok) {
        this.logger.warn(`Routes API respondeu ${resp.status}.`);
        return null;
      }

      const dados = (await resp.json()) as {
        routes?: Array<{
          optimizedIntermediateWaypointIndex?: number[];
          distanceMeters?: number;
          duration?: string;
          legs?: Array<{ distanceMeters?: number; duration?: string }>;
        }>;
      };

      const rota = dados.routes?.[0];
      if (!rota?.legs?.length) return null;

      const ordem =
        rota.optimizedIntermediateWaypointIndex ??
        intermediarios.map((_, i) => i);

      const sequencia = [...ordem.map((i) => intermediarios[i]), destino];

      const itens: RotaItem[] = sequencia.map((parada, k) => {
        const trecho = rota.legs?.[k];
        return {
          pedido_id: parada.pedido_id,
          sequencia: k + 1,
          distancia_m: trecho?.distanceMeters ?? null,
          tempo_seg: segundosDeDuracao(trecho?.duration),
        };
      });

      return {
        itens,
        otimizada: true,
        fonte: 'google',
        distancia_total_m: rota.distanceMeters ?? null,
        tempo_total_seg: segundosDeDuracao(rota.duration),
      };
    } catch (erro) {
      this.logger.warn(`Falha ao chamar a Routes API: ${erro}`);
      return null;
    }
  }

  /**
   * Fallback sem rede: vizinho-mais-próximo sobre distância Haversine.
   * A distância é em linha reta (não segue ruas) e o tempo é estimado por uma
   * velocidade média urbana — serve para não travar a operação quando o roteador
   * está fora do ar, não para prometer precisão.
   */
  private viaHaversine(
    partida: PontoPartida,
    paradas: Parada[],
  ): Omit<RotaResultado, 'sem_coordenadas'> {
    const kmh = Number(this.config.get<string>('ROTA_VELOCIDADE_KMH', '25'));
    const metrosPorSegundo = (kmh * 1000) / 3600;

    const pendentes = [...paradas];
    const itens: RotaItem[] = [];
    let atual: Coord = partida;
    let distanciaTotal = 0;
    let tempoTotal = 0;

    while (pendentes.length) {
      let idxMaisProximo = 0;
      let menorDist = Infinity;

      pendentes.forEach((p, i) => {
        const d = distanciaHaversineM(atual, p.coord);
        if (d < menorDist) {
          menorDist = d;
          idxMaisProximo = i;
        }
      });

      const [proxima] = pendentes.splice(idxMaisProximo, 1);
      const distancia = Math.round(menorDist);
      const tempo = Math.round(menorDist / metrosPorSegundo);

      distanciaTotal += distancia;
      tempoTotal += tempo;

      itens.push({
        pedido_id: proxima.pedido_id,
        sequencia: itens.length + 1,
        distancia_m: distancia,
        tempo_seg: tempo,
      });

      atual = proxima.coord;
    }

    return {
      itens,
      otimizada: false,
      fonte: 'haversine',
      distancia_total_m: distanciaTotal,
      tempo_total_seg: tempoTotal,
    };
  }

  private coordDoPedido(pedido: Pedido): Coord | null {
    if (pedido.lat == null || pedido.lng == null) return null;
    const lat = Number(pedido.lat);
    const lng = Number(pedido.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    // (0,0) é o "ponto nulo" no Atlântico: quase sempre dado sujo, não endereço.
    if (lat === 0 && lng === 0) return null;
    return { lat, lng };
  }
}

/** Distância em metros entre dois pontos, em linha reta sobre a esfera. */
export function distanciaHaversineM(a: Coord, b: Coord): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;

  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A Routes API devolve duração como string no formato "123s". */
function segundosDeDuracao(duracao: string | undefined): number | null {
  if (!duracao) return null;
  const n = parseInt(duracao.replace('s', ''), 10);
  return Number.isFinite(n) ? n : null;
}
