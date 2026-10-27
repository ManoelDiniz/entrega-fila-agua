import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/utils';

const OSRM_URL = import.meta.env.VITE_OSRM_URL ?? 'https://router.project-osrm.org';

export interface ParadaMapa {
  sequencia: number;
  lat: number;
  lng: number;
  rotulo: string;
  entregue: boolean;
}

interface Props {
  partida: { lat: number; lng: number } | null;
  paradas: ParadaMapa[];
  className?: string;
}

/**
 * Mapa da rota com Leaflet + tiles do OpenStreetMap — sem chave de API.
 *
 * O traçado que segue as ruas vem do OSRM (/route com geometries=geojson),
 * chamado com as paradas já na ordem que o backend otimizou. Se essa chamada
 * falhar, o mapa cai para linhas retas ligando as paradas: perde o traçado
 * bonito, mas a sequência e os pinos continuam corretos.
 */
export function MapaRota({ partida, paradas, className }: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const camadaRef = useRef<L.LayerGroup | null>(null);

  // Cria o mapa uma vez.
  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;

    const mapa = L.map(divRef.current, { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(mapa);

    mapaRef.current = mapa;
    camadaRef.current = L.layerGroup().addTo(mapa);

    return () => {
      mapa.remove();
      mapaRef.current = null;
      camadaRef.current = null;
    };
  }, []);

  // Redesenha pinos e traçado quando a rota muda.
  useEffect(() => {
    const mapa = mapaRef.current;
    const camada = camadaRef.current;
    if (!mapa || !camada) return;

    camada.clearLayers();

    const pontos: L.LatLngExpression[] = [];

    if (partida) {
      L.marker([partida.lat, partida.lng], { icon: iconePartida() })
        .bindPopup('Sua partida')
        .addTo(camada);
      pontos.push([partida.lat, partida.lng]);
    }

    for (const p of paradas) {
      L.marker([p.lat, p.lng], { icon: iconeParada(p.sequencia, p.entregue) })
        .bindPopup(`<b>${p.sequencia}. ${p.rotulo}</b>`)
        .addTo(camada);
      pontos.push([p.lat, p.lng]);
    }

    if (pontos.length === 0) return;

    mapa.fitBounds(L.latLngBounds(pontos), { padding: [30, 30], maxZoom: 16 });

    if (pontos.length < 2) return;

    // Linha reta primeiro (resposta imediata), trocada pelo traçado real assim
    // que o OSRM responder.
    const provisoria = L.polyline(pontos, {
      color: '#94a3b8',
      weight: 3,
      dashArray: '6 6',
    }).addTo(camada);

    let cancelado = false;

    tracadoDasRuas(pontos)
      .then((linha) => {
        if (cancelado || !linha) return;
        camada.removeLayer(provisoria);
        L.polyline(linha, { color: '#0284c7', weight: 5, opacity: 0.8 }).addTo(
          camada,
        );
      })
      .catch(() => {
        /* mantém a linha reta */
      });

    return () => {
      cancelado = true;
    };
  }, [partida, paradas]);

  return (
    // `relative` + `z-0` são OBRIGATÓRIOS juntos, não decoração: o Leaflet dá
    // z-index de 400 a 1000 às camadas dele (marcadores, popups, controles) e o
    // .leaflet-container não é posicionado — então esses valores sobem até a raiz
    // da página e passam por cima do header (z-40) e dos menus (z-50), cobrindo o
    // botão "Sair". Um elemento posicionado COM z-index cria um contexto de
    // empilhamento que prende tudo isso aqui dentro.
    // (z-index sozinho não faz nada em elemento sem `position`.)
    <div ref={divRef} className={cn('relative z-0', className)} />
  );
}

/** Busca no OSRM o traçado que segue as ruas, na ordem já otimizada. */
async function tracadoDasRuas(
  pontos: L.LatLngExpression[],
): Promise<L.LatLngExpression[] | null> {
  const coords = (pontos as [number, number][])
    .map(([lat, lng]) => `${lng},${lat}`) // OSRM usa lon,lat
    .join(';');

  const resp = await fetch(
    `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`,
  );
  if (!resp.ok) return null;

  const dados = await resp.json();
  const linha = dados?.routes?.[0]?.geometry?.coordinates;
  if (!Array.isArray(linha)) return null;

  // GeoJSON devolve [lng, lat]; o Leaflet quer [lat, lng].
  return linha.map(([lng, lat]: [number, number]) => [lat, lng]);
}

function iconeParada(sequencia: number, entregue: boolean) {
  const cor = entregue ? '#16a34a' : '#0284c7';
  return L.divIcon({
    className: '',
    html: `<div style="
      background:${cor};color:#fff;width:26px;height:26px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font:bold 13px system-ui;border:2px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,.4)">${entregue ? '✓' : sequencia}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
}

function iconePartida() {
  return L.divIcon({
    className: '',
    html: `<div style="
      background:#0f172a;color:#fff;width:22px;height:22px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font:12px system-ui;border:2px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,.4)">🚚</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}
