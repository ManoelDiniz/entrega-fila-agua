import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, Map as MapIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Ponto {
  lat: number;
  lng: number;
}

const TILES = {
  ruas: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap',
  },
  // Esri World Imagery: satélite gratuito, sem chave. Atenção à ordem {z}/{y}/{x},
  // que é invertida em relação ao padrão do OSM.
  satelite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '&copy; Esri',
  },
} as const;

/**
 * Mapa de um único ponto, com pino arrastável.
 *
 * O arrasto não é enfeite: o OpenStreetMap quase nunca tem o número de casa
 * residencial no Brasil, então o geocodificador devolve a RUA e o pino cai em algum
 * ponto de uma via que pode ter centenas de metros. Quem sabe qual é a casa é a
 * pessoa. Clicar no mapa também move o pino.
 *
 * O satélite existe pelo mesmo motivo: num mapa de ruas, uma quadra residencial é
 * um retângulo em branco — não dá para se localizar. Com a imagem, o operador
 * reconhece telhado, muro e esquina, e acha a casa de verdade.
 */
export function MapaPonto({
  ponto,
  onMover,
  className,
}: {
  ponto: Ponto | null;
  onMover?: (p: Ponto) => void;
  className?: string;
}) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapaRef = useRef<L.Map | null>(null);
  const marcadorRef = useRef<L.Marker | null>(null);
  const camadaRef = useRef<L.TileLayer | null>(null);
  const [satelite, setSatelite] = useState(false);

  // Em ref, não em dep: recriar o mapa a cada render do pai mataria o arrasto.
  const onMoverRef = useRef(onMover);
  onMoverRef.current = onMover;

  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;

    const mapa = L.map(divRef.current, { scrollWheelZoom: false }).setView(
      [-3.73, -38.52],
      13,
    );

    mapa.on('click', (e: L.LeafletMouseEvent) => {
      onMoverRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapaRef.current = mapa;

    return () => {
      mapa.remove();
      mapaRef.current = null;
      marcadorRef.current = null;
      camadaRef.current = null;
    };
  }, []);

  // Troca a camada de tiles sem recriar o mapa (o pino e o zoom ficam onde estão).
  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    const { url, attribution } = TILES[satelite ? 'satelite' : 'ruas'];
    const nova = L.tileLayer(url, { attribution, maxZoom: 19 });

    nova.addTo(mapa);
    camadaRef.current?.remove();
    camadaRef.current = nova;
    // O pino tem que ficar por cima da imagem nova.
    marcadorRef.current?.setZIndexOffset(1000);
  }, [satelite]);

  useEffect(() => {
    const mapa = mapaRef.current;
    if (!mapa) return;

    if (!ponto) {
      marcadorRef.current?.remove();
      marcadorRef.current = null;
      return;
    }

    if (!marcadorRef.current) {
      const marcador = L.marker([ponto.lat, ponto.lng], {
        icon: iconePino(),
        draggable: !!onMoverRef.current,
        autoPan: true,
        zIndexOffset: 1000,
      }).addTo(mapa);

      marcador.on('dragend', () => {
        const { lat, lng } = marcador.getLatLng();
        onMoverRef.current?.({ lat, lng });
      });

      marcadorRef.current = marcador;
    } else {
      marcadorRef.current.setLatLng([ponto.lat, ponto.lng]);
    }

    // Zoom alto: em zoom baixo o pino "parece" na casa certa com 200 m de erro.
    mapa.setView([ponto.lat, ponto.lng], Math.max(mapa.getZoom(), 18));
  }, [ponto]);

  return (
    // `relative` + `z-0` são OBRIGATÓRIOS juntos: o Leaflet dá z-index de até 1000
    // às camadas dele e o .leaflet-container não é posicionado, então esses valores
    // sobem até a raiz e passam por cima do header. Um elemento posicionado COM
    // z-index cria um contexto de empilhamento que prende tudo aqui dentro.
    <div className={cn('relative z-0 overflow-hidden', className)}>
      <div ref={divRef} className="absolute inset-0" />

      <button
        type="button"
        onClick={() => setSatelite((s) => !s)}
        // z-[1001]: acima dos controles do Leaflet (que vão até 1000), mas ainda
        // dentro do contexto de empilhamento criado acima.
        className="bg-background/95 text-foreground hover:bg-background absolute top-2 right-2 z-[1001] flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm backdrop-blur transition-colors"
      >
        {satelite ? <MapIcon className="size-3.5" /> : <Layers className="size-3.5" />}
        {satelite ? 'Ver mapa' : 'Ver satélite'}
      </button>
    </div>
  );
}

function iconePino() {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:30px;height:30px;border-radius:50% 50% 50% 0;
      background:#0284c7;border:3px solid #fff;transform:rotate(-45deg);
      box-shadow:0 2px 8px rgba(0,0,0,.5);cursor:grab"></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });
}
