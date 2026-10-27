import { api } from '@/api';

/**
 * Quão preciso é o ponto devolvido. Enum fechado do backend.
 *
 * Só `casa` significa "o pino está na porta". Todo o resto significa que o número
 * NÃO foi encontrado e o pino caiu em algum lugar da via — que pode ter centenas
 * de metros.
 */
export type Precisao = 'casa' | 'rua' | 'bairro' | 'cidade' | 'aproximada';

/** Candidato devolvido por GET /api/geo/enderecos. */
export interface CandidatoEndereco {
  lat: number;
  lng: number;
  /** O endereço como o geocodificador o entendeu — cru, com CEP/estado/país. */
  endereco: string;
  precisao: Precisao;
  /** O número da casa, quando o provedor realmente o achou. Senão null. */
  numero: string | null;
  /** Partes separadas, para montar um rótulo curto sem o ruído do `endereco`. */
  rua: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
}

/**
 * Rótulo curto do candidato: "Avenida Central — Icaraí — Caucaia".
 *
 * O `encontrado` cru traz CEP, "Região Nordeste" e "Brasil" — ruído que não ajuda a
 * decidir NADA sobre onde a casa está, e foi exatamente o que confundiu o operador.
 */
export function rotularCandidato(c: CandidatoEndereco): string {
  const partes = [c.rua, c.bairro, c.cidade].filter(Boolean);
  return partes.length ? partes.join(' — ') : c.endereco;
}

export interface AreaOperacao {
  /** Texto legível vindo do servidor: "Fortaleza e Caucaia". */
  cidades: string;
  viewbox: string;
  limites: { lonMin: number; latMin: number; lonMax: number; latMax: number };
  /** `false` = servidor SEM cerca: endereço vago pode casar com outro estado. */
  cercaAtiva: boolean;
}

/**
 * Onde a empresa entrega, segundo o servidor.
 *
 * Lido, nunca chumbado na tela. Quando a área mudar (o dono expandir para
 * Maracanaú), a mensagem "a entrega cobre X" muda junto — sozinha. Chumbado, o
 * texto continuaria afirmando a área velha com ar de verdade oficial, que é
 * exatamente como um aviso vira mentira.
 */
export async function buscarArea(): Promise<AreaOperacao | null> {
  try {
    const r = await api.get<AreaOperacao>('/geo/area');
    return r.data;
  } catch {
    return null;
  }
}

export interface EnderecoCep {
  cep: string;
  logradouro: string;
  bairro: string;
  cidade: string;
  uf: string;
}

/**
 * CEP → texto do endereço (ViaCEP). NÃO devolve coordenadas: é o passo ANTES da
 * geocodificação.
 *
 * Serve pra desambiguar rua homônima, que o Nominatim sozinho não resolve: "Rua
 * Barão de Aracati, Fortaleza" devolve TRÊS ruas (Aldeota, Meireles, Joaquim
 * Távora) e o atendente não tem como saber qual é. O CEP diz.
 *
 * `null` quando o CEP não existe (404).
 */
export async function buscarCep(cep: string): Promise<EnderecoCep | null> {
  const limpo = cep.replace(/\D/g, '');
  if (limpo.length !== 8) return null;

  try {
    const r = await api.get<EnderecoCep>(`/geo/cep/${limpo}`);
    return r.data;
  } catch {
    return null;
  }
}

/**
 * Converte texto em candidatos de coordenada, já restritos à área de operação
 * pela cerca geográfica do backend.
 *
 * Vai pelo backend de propósito, e não direto no Nominatim: o servidor serializa
 * as chamadas (~1 req/s, política de uso do OSM) e aplica a cerca — o que impede
 * casar "Av. Central" com uma rua homônima a 3.000 km.
 *
 * Lista vazia = não achou DENTRO da área. Não é erro: é o atendente precisar dar
 * um endereço mais completo, ou posicionar o pino na mão.
 */
export async function buscarEnderecos(q: string): Promise<CandidatoEndereco[]> {
  const r = await api.get<CandidatoEndereco[]>('/geo/enderecos', { params: { q } });
  return Array.isArray(r.data) ? r.data : [];
}

/**
 * `lat`/`lng` chegam como string (DECIMAL do MySQL) e precisam sair como number
 * (@IsNumber nos DTOs). A assimetria é do backend; normalizo aqui.
 */
export function paraPonto(
  lat: string | number | null | undefined,
  lng: string | number | null | undefined,
) {
  if (lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  return Number.isFinite(la) && Number.isFinite(ln) ? { lat: la, lng: ln } : null;
}
