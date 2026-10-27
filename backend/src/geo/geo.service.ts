import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface Coordenada {
  lat: number;
  lng: number;
  /** Endereço como o provedor o entendeu — serve para o atendente conferir. */
  endereco?: string;
}

/**
 * Quão fundo o geocodificador chegou.
 *
 * Isto NÃO é enfeite: é a diferença entre "o pino está na casa" e "o pino está em
 * algum lugar dessa rua, que tem 800 metros". O OpenStreetMap tem cobertura muito
 * ruim de número de casa no Brasil — casa residencial quase nunca está mapeada, e
 * casa residencial é exatamente o cliente de uma entregadora de água.
 *
 * Sem este campo, o sistema devolvia a rua e a tela dizia "endereço localizado",
 * como se o número tivesse sido encontrado. Mentira silenciosa.
 */
export type PrecisaoEndereco = 'casa' | 'rua' | 'bairro' | 'cidade' | 'aproximada';

/** Um candidato devolvido pela busca de endereço, para o atendente escolher. */
export interface EnderecoCandidato {
  lat: number;
  lng: number;
  /** Endereço completo, cru, como o provedor o entendeu (traz CEP, estado, país). */
  endereco: string;
  /** Até onde o geocodificador chegou. `rua` significa: NÚMERO NÃO ENCONTRADO. */
  precisao: PrecisaoEndereco;
  /** O número da casa, quando o provedor realmente o achou. */
  numero: string | null;

  // Partes separadas, para a tela montar um rótulo curto e legível em vez de
  // despejar o `endereco` inteiro (que vem com CEP, estado, região e "Brasil" —
  // ruído que não ajuda ninguém a decidir qual é a casa do cliente).
  rua: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

/** Endereço resolvido a partir do CEP (ViaCEP). */
export interface EnderecoCep {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

/**
 * Geocodificação: endereço em texto -> coordenadas.
 *
 * Dois provedores:
 *   - nominatim (padrão) — OpenStreetMap, gratuito, sem chave.
 *   - google — Geocoding API, exige GOOGLE_MAPS_API_KEY e billing.
 *
 * O provedor é escolhido por GEO_PROVIDER; se for "google" mas não houver
 * chave, cai para o Nominatim automaticamente.
 *
 * ATENÇÃO ao Nominatim público: a política de uso permite no máximo
 * 1 requisição por segundo e exige um User-Agent que identifique a aplicação.
 * Por isso as chamadas são serializadas por uma fila interna (ver `enfileirar`).
 * Para volume alto, suba um Nominatim próprio e aponte NOMINATIM_URL para ele.
 */
@Injectable()
export class GeoService {
  private readonly logger = new Logger(GeoService.name);

  /** Serializa as chamadas ao Nominatim (rate limit de 1/s). */
  private proximaChamada = Promise.resolve();

  constructor(private readonly config: ConfigService) {
    // Logado na subida de propósito: uma cerca ausente faz endereços vagos
    // geocodificarem para a cidade errada SEM erro nenhum. Melhor gritar aqui.
    const viewbox = this.config.get<string>('GEO_VIEWBOX');
    const provedor = this.config.get<string>('GEO_PROVIDER', 'nominatim');
    if (viewbox) {
      this.logger.log(`Geocodificação via ${provedor}, restrita a ${viewbox}.`);
    } else {
      this.logger.warn(
        `Geocodificação via ${provedor} SEM cerca (GEO_VIEWBOX vazio): um ` +
          `endereço vago pode cair em outra cidade e virar entrega errada.`,
      );
    }
  }

  /**
   * Busca candidatos de endereço, para o atendente ESCOLHER o ponto certo antes
   * de salvar o cliente.
   *
   * Existe porque `geocodificar` decide sozinho, e essa decisão é perigosa:
   * "Av. Central, 1000" tem uma resposta plausível em várias cidades. Mostrando
   * os candidatos, quem decide é a pessoa que conhece o cliente.
   */
  async buscarEnderecos(
    texto: string,
    limite = 5,
  ): Promise<EnderecoCandidato[]> {
    const q = texto?.trim();
    if (!q || q.length < 3) return [];

    const chaveGoogle = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    const provedor = this.config.get<string>('GEO_PROVIDER', 'nominatim');

    if (provedor === 'google' && chaveGoogle) {
      const achados = await this.viaGoogle(q, chaveGoogle, limite);
      if (achados.length) return achados;
      this.logger.warn('Google Geocoding não retornou nada; tentando Nominatim.');
    }

    return this.viaNominatim(q, limite);
  }

  /** Primeira coordenada para um endereço, ou null se não achar. */
  async geocodificar(endereco: string): Promise<Coordenada | null> {
    const [primeiro] = await this.buscarEnderecos(endereco, 1);
    return primeiro ?? null;
  }

  /**
   * CEP -> rua, bairro, cidade, UF (ViaCEP: gratuito, sem chave, brasileiro).
   *
   * Existe porque o Nominatim sozinho não desambigua rua homônima: "Rua Barão de
   * Aracati, Fortaleza" devolve TRÊS ruas, em Aldeota, Meireles e Joaquim Távora.
   * O CEP diz qual é. Depois disso o Nominatim acha o trecho certo da rua certa —
   * e o número da casa fica por conta do atendente, arrastando o pino.
   *
   * O ViaCEP NÃO devolve coordenadas: ele resolve o TEXTO do endereço, não o ponto.
   */
  async buscarPorCep(cep: string): Promise<EnderecoCep | null> {
    const limpo = (cep ?? '').replace(/\D/g, '');
    if (limpo.length !== 8) return null;

    const base = this.config.get<string>('VIACEP_URL', 'https://viacep.com.br');

    try {
      const resp = await fetch(`${base}/ws/${limpo}/json/`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) {
        this.logger.warn(`ViaCEP respondeu ${resp.status}.`);
        return null;
      }

      const d = (await resp.json()) as {
        erro?: boolean | string;
        cep?: string;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };

      // O ViaCEP devolve 200 com `{"erro": true}` para CEP inexistente.
      if (d.erro || !d.logradouro) {
        this.logger.warn(`CEP não encontrado: ${limpo}.`);
        return null;
      }

      return {
        cep: d.cep ?? limpo,
        logradouro: d.logradouro,
        bairro: d.bairro ?? '',
        cidade: d.localidade ?? '',
        uf: d.uf ?? '',
      };
    } catch (erro) {
      this.logger.warn(`Falha ao consultar o ViaCEP: ${erro}`);
      return null;
    }
  }

  /**
   * Nominatim (OpenStreetMap). Gratuito e sem chave.
   * As chamadas são serializadas com 1s de intervalo para respeitar a política
   * de uso do servidor público.
   */
  private async viaNominatim(
    endereco: string,
    limite: number,
  ): Promise<EnderecoCandidato[]> {
    const base = this.config.get<string>(
      'NOMINATIM_URL',
      'https://nominatim.openstreetmap.org',
    );
    const pais = this.config.get<string>('GEO_COUNTRY', 'br');
    const userAgent = this.config.get<string>(
      'NOMINATIM_USER_AGENT',
      'entrega-fila-agua/0.1 (contato: troque-pelo-seu-email)',
    );

    const url = new URL(`${base}/search`);
    url.searchParams.set('q', endereco);
    url.searchParams.set('format', 'jsonv2');
    // Pede MAIS do que vamos devolver: boa parte dos resultados é o mesmo trecho
    // de rua repetido (muda só o bairro atribuído ou o CEP), e esses são
    // colapsados logo abaixo. Pedindo o limite exato, sobrariam 1 ou 2 opções.
    url.searchParams.set('limit', String(Math.min(limite * 3, 20)));
    // Traz o `address.house_number` quando o prédio está mapeado — é o que nos
    // deixa dizer se o número foi realmente encontrado ou se paramos na rua.
    url.searchParams.set('addressdetails', '1');
    if (pais) url.searchParams.set('countrycodes', pais);

    // Cerca geográfica. SEM isso, um endereço vago ("Av. Central, 1000", sem
    // cidade) casa com uma rua homônima em qualquer canto do país e devolve uma
    // coordenada errada COM CARA DE CERTA — o entregador seria mandado a
    // milhares de km. Com bounded=1 o Nominatim recusa o que cai fora da caixa,
    // e o cliente fica sem coordenada (falha visível) em vez de com a coordenada
    // errada (falha silenciosa).
    const viewbox = this.config.get<string>('GEO_VIEWBOX');
    if (viewbox) {
      url.searchParams.set('viewbox', viewbox);
      url.searchParams.set('bounded', '1');
    }

    return this.enfileirar(async () => {
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': userAgent, 'Accept-Language': 'pt-BR' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!resp.ok) {
          this.logger.warn(`Nominatim respondeu ${resp.status}.`);
          return [];
        }

        const dados = (await resp.json()) as Array<{
          lat: string;
          lon: string;
          display_name?: string;
          addresstype?: string;
          address?: {
            house_number?: string;
            road?: string;
            suburb?: string;
            neighbourhood?: string;
            city?: string;
            town?: string;
            municipality?: string;
            state?: string;
          };
        }>;

        if (!dados?.length) {
          this.logger.warn(
            `Endereço não encontrado no Nominatim: "${endereco}"` +
              (viewbox ? ' (dentro da área de operação).' : '.'),
          );
          return [];
        }

        const candidatos = dados.map((d) => {
          const a = d.address ?? {};
          const numero = a.house_number ?? null;
          return {
            lat: Number(d.lat),
            lng: Number(d.lon),
            endereco: d.display_name ?? endereco,
            numero,
            precisao: precisaoDe(d.addresstype, numero),
            rua: a.road ?? null,
            bairro: a.suburb ?? a.neighbourhood ?? null,
            cidade: a.city ?? a.town ?? a.municipality ?? null,
            uf: a.state ?? null,
          };
        });

        return removerDuplicados(candidatos).slice(0, limite);
      } catch (erro) {
        this.logger.warn(`Falha ao geocodificar via Nominatim: ${erro}`);
        return [];
      }
    });
  }

  /**
   * NOTA: não exercitado — não há chave da Google neste ambiente. O caminho
   * testado, e o padrão, é o Nominatim.
   */
  private async viaGoogle(
    endereco: string,
    chave: string,
    limite: number,
  ): Promise<EnderecoCandidato[]> {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', endereco);
    url.searchParams.set('key', chave);
    url.searchParams.set('region', this.config.get<string>('GEO_COUNTRY', 'br'));

    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const dados = (await resp.json()) as {
        status: string;
        results?: Array<{
          formatted_address?: string;
          types?: string[];
          address_components?: Array<{ types: string[]; long_name: string }>;
          geometry: { location: { lat: number; lng: number } };
        }>;
      };

      if (dados.status !== 'OK' || !dados.results?.length) {
        this.logger.warn(`Google Geocoding: status ${dados.status}.`);
        return [];
      }

      const parte = (
        r: { address_components?: Array<{ types: string[]; long_name: string }> },
        tipo: string,
      ) =>
        r.address_components?.find((c) => c.types.includes(tipo))?.long_name ??
        null;

      const candidatos = dados.results.slice(0, limite).map((r) => {
        const numero = parte(r, 'street_number');

        // A Google usa "street_address"/"premise" quando chegou na casa e
        // "route" quando parou na rua — mesma distinção do Nominatim.
        const tipo = r.types?.includes('route') ? 'road' : undefined;

        return {
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
          endereco: r.formatted_address ?? endereco,
          numero,
          precisao: precisaoDe(tipo, numero),
          rua: parte(r, 'route'),
          bairro: parte(r, 'sublocality') ?? parte(r, 'sublocality_level_1'),
          cidade:
            parte(r, 'administrative_area_level_2') ?? parte(r, 'locality'),
          uf: parte(r, 'administrative_area_level_1'),
        };
      });

      return removerDuplicados(candidatos);
    } catch (erro) {
      this.logger.warn(`Falha ao geocodificar via Google: ${erro}`);
      return [];
    }
  }

  /**
   * Serializa as chamadas com 1s de espaçamento (política do Nominatim público).
   * Cada tarefa só começa depois que a anterior terminou + 1s.
   */
  private enfileirar<T>(tarefa: () => Promise<T>): Promise<T> {
    const resultado = this.proximaChamada.then(tarefa);
    this.proximaChamada = resultado.then(
      () => new Promise((r) => setTimeout(r, 1000)),
      () => new Promise((r) => setTimeout(r, 1000)),
    );
    return resultado;
  }
}

/**
 * Traduz o tipo de resultado do geocodificador em "quão fundo ele chegou".
 *
 * A regra que importa: se veio `numero`, o prédio está mapeado e o pino está na
 * porta. Se o tipo é `road`, o geocodificador ACHOU A RUA E DESCARTOU O NÚMERO
 * EM SILÊNCIO — o pino cai em algum ponto de uma via que pode ter centenas de
 * metros. É a diferença entre entregar e rodar procurando.
 */
function precisaoDe(
  addresstype: string | undefined,
  numero: string | null,
): PrecisaoEndereco {
  if (numero) return 'casa';

  switch (addresstype) {
    case 'road':
      return 'rua';
    case 'suburb':
    case 'neighbourhood':
    case 'quarter':
    case 'city_district':
      return 'bairro';
    case 'city':
    case 'town':
    case 'municipality':
    case 'village':
      return 'cidade';
    default:
      return 'aproximada';
  }
}

/**
 * Distância mínima para dois candidatos serem considerados lugares diferentes.
 *
 * O Nominatim devolve o MESMO trecho de rua várias vezes, mudando só o bairro que
 * ele atribui ou o CEP. Numa busca real, dois candidatos vieram a 12 METROS um do
 * outro — e a tela pedia ao atendente para escolher entre eles, mostrando o CEP
 * como se fosse a diferença. Não é escolha: é ruído que empurra a pessoa para um
 * palpite sem resposta certa.
 */
const DISTANCIA_MINIMA_M = 150;

/**
 * Colapsa candidatos que apontam para o mesmo lugar.
 *
 * Mantém o primeiro (o Nominatim já ordena por relevância) e descarta quem estiver
 * a menos de DISTANCIA_MINIMA_M dele. Trechos realmente distintos da mesma avenida
 * (o caso do candidato a 1 km) continuam aparecendo — esses são uma escolha de
 * verdade.
 */
function removerDuplicados(
  candidatos: EnderecoCandidato[],
): EnderecoCandidato[] {
  const mantidos: EnderecoCandidato[] = [];

  for (const c of candidatos) {
    const repetido = mantidos.some(
      (m) => distanciaM(m, c) < DISTANCIA_MINIMA_M,
    );
    if (!repetido) mantidos.push(c);
  }

  return mantidos;
}

/** Haversine em metros. */
function distanciaM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
