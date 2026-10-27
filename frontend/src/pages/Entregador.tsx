import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import {
  Check,
  Inbox,
  Loader2,
  MapPin,
  Minus,
  Navigation,
  PackageCheck,
  Plus,
  RefreshCw,
  TriangleAlert,
  Truck,
  X,
} from 'lucide-react';
import axios from 'axios';
import { toast } from 'sonner';
import { api } from '@/api';
import { getSocket, subscribe } from '@/socket';
import { useAuth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PriorityBadge } from '@/components/priority-badge';
import type { ParadaMapa } from '@/components/MapaRota';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// Leaflet só é baixado quando existe um lote com rota pra desenhar. O entregador
// abre o app na rua, no 3G — não faz sentido pagar ~150kB antes de puxar o lote.
const MapaRota = lazy(() =>
  import('@/components/MapaRota').then((m) => ({ default: m.MapaRota })),
);

interface FilaResp {
  contagem: { total: number };
}

interface LoteItem {
  id: string;
  sequencia: number;
  distancia_m: number | null;
  tempo_seg: number | null;
  entregue_em: string | null;
  pedido: {
    id: string;
    prioridade: string;
    lat: string | null;
    lng: string | null;
    observacao: string | null;
    cliente?: { nome: string; endereco: string };
  };
}

/** Só vem na criação e na reotimização — não é persistido no banco. */
interface ResumoRota {
  fonte: 'osrm' | 'google' | 'haversine' | 'sem_coordenadas';
  otimizada: boolean;
  distancia_total_m: number | null;
  tempo_total_seg: number | null;
  sem_coordenadas: string[];
}

interface Lote {
  id: string;
  status: string;
  qtd_pedidos: number;
  lat_partida: string | null;
  lng_partida: string | null;
  itens: LoteItem[];
  rota?: ResumoRota;
}

/**
 * Extrai a mensagem de erro do Nest.
 *
 * `message` vem como STRING em erro de negócio ("Há 2 entrega(s) pendente(s)…") e
 * como ARRAY em erro de validação do DTO. Tratar só a string renderizaria
 * "[object Object]" justamente no caso em que o texto importa.
 */
function mensagemDoBackend(e: unknown): string | null {
  if (!axios.isAxiosError(e)) return null;
  const m = (e.response?.data as { message?: string | string[] } | undefined)?.message;
  if (Array.isArray(m)) return m.join(' · ');
  return m ?? null;
}

/** Enum FECHADO no backend: qualquer outro valor dá 400. */
const MOTIVOS = [
  { valor: 'cliente_ausente', rotulo: 'Cliente não estava' },
  { valor: 'endereco_nao_encontrado', rotulo: 'Endereço não encontrado' },
  { valor: 'cliente_recusou', rotulo: 'Cliente recusou' },
  { valor: 'outro', rotulo: 'Outro motivo' },
] as const;

type Motivo = (typeof MOTIVOS)[number]['valor'];

function formatarDistancia(m: number | null) {
  if (m == null) return null;
  return m < 1000
    ? `${Math.round(m)} m`
    : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

function formatarTempo(seg: number | null) {
  if (seg == null) return null;
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

function coord(lat?: string | null, lng?: string | null) {
  if (lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return { lat: la, lng: ln };
}

export function Entregador() {
  const { usuario } = useAuth();
  const [totalFila, setTotalFila] = useState(0);
  const [qtd, setQtd] = useState(3);
  const [lote, setLote] = useState<Lote | null>(null);
  const [puxando, setPuxando] = useState(false);
  const [reotimizando, setReotimizando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [entregandoId, setEntregandoId] = useState<string | null>(null);

  // --- Não entregue ---
  const [naoEntregue, setNaoEntregue] = useState<LoteItem | null>(null);
  const [motivo, setMotivo] = useState<Motivo>('cliente_ausente');
  const [observacaoNE, setObservacaoNE] = useState('');
  const [salvandoNaoEntregue, setSalvandoNaoEntregue] = useState(false);

  const carregarFila = useCallback(async () => {
    try {
      const r = await api.get<FilaResp>('/fila');
      setTotalFila(r.data.contagem.total);
    } catch {
      /* silencioso: o número é informativo, não bloqueia o trabalho */
    }
  }, []);

  useEffect(() => {
    carregarFila();

    // Recupera o lote que já estava em andamento. Sem isso, um F5 no meio da
    // rota faz o entregador perder a lista inteira de entregas.
    api
      .get<Lote | null>('/lotes/em-andamento')
      .then((r) => r.data && setLote(r.data))
      .catch(() => {
        /* sem lote aberto */
      });

    subscribe('entregador', usuario?.id);

    const socket = getSocket();
    const onFila = () => carregarFila();
    socket.on('fila:atualizada', onFila);
    return () => {
      socket.off('fila:atualizada', onFila);
    };
  }, [carregarFila, usuario?.id]);

  async function puxarLote() {
    setPuxando(true);
    try {
      // GPS atual do entregador — é o ponto de partida da rota.
      const pos = await obterPosicao();
      if (!pos.preciso) {
        toast.warning('GPS indisponível', {
          description: 'Usando posição padrão; a rota pode não ser a ideal.',
        });
      }

      const r = await api.post<Lote>('/lotes', {
        qtd,
        lat: pos.lat,
        lng: pos.lng,
      });
      setLote(r.data);
      await carregarFila();

      const km = formatarDistancia(r.data.rota?.distancia_total_m ?? null);
      const tempo = formatarTempo(r.data.rota?.tempo_total_seg ?? null);
      toast.success(`Lote #${r.data.id} puxado`, {
        description:
          km && tempo
            ? `${r.data.itens.length} entrega(s) · ${km} · ${tempo}`
            : `${r.data.itens.length} entrega(s) na sua rota.`,
      });
    } catch {
      toast.error('Não foi possível puxar o lote.', {
        description: 'A fila pode estar vazia. Tente de novo em instantes.',
      });
    } finally {
      setPuxando(false);
    }
  }

  async function reotimizar() {
    if (!lote) return;
    setReotimizando(true);
    try {
      // Recalcula a partir de onde o entregador está AGORA, não de onde saiu.
      const pos = await obterPosicao();
      const r = await api.post<Lote>(`/lotes/${lote.id}/reotimizar`, {
        lat: pos.lat,
        lng: pos.lng,
      });
      setLote(r.data);
      toast.success('Rota recalculada a partir da sua posição.');
    } catch {
      toast.error('Não foi possível recalcular a rota.');
    } finally {
      setReotimizando(false);
    }
  }

  async function marcarEntregue(item: LoteItem) {
    if (!lote) return;
    setEntregandoId(item.pedido.id);
    try {
      const r = await api.patch<Lote>(
        `/lotes/${lote.id}/pedidos/${item.pedido.id}/entregue`,
      );
      setLote(r.data);
      toast.success(`Entrega ${item.sequencia} concluída`, {
        description: item.pedido.cliente?.nome,
      });
    } catch {
      toast.error('Não foi possível marcar como entregue.');
    } finally {
      setEntregandoId(null);
    }
  }

  /**
   * Entrega que não aconteceu: o pedido VOLTA para a fila com o motivo registrado.
   *
   * Sem isto, o entregador só tinha "Entregar" — e a saída dele era finalizar o
   * lote assim mesmo, o que deixava o pedido preso em `em_rota`: fora da fila,
   * amarrado a um lote encerrado e impossível de reatribuir. O cliente sumia do
   * sistema sem erro nenhum.
   */
  async function marcarNaoEntregue() {
    if (!lote || !naoEntregue) return;
    setSalvandoNaoEntregue(true);
    try {
      const r = await api.patch<Lote>(
        `/lotes/${lote.id}/pedidos/${naoEntregue.pedido.id}/nao-entregue`,
        { motivo, observacao: observacaoNE.trim() || undefined },
      );
      setLote(r.data);
      setNaoEntregue(null);
      setObservacaoNE('');
      setMotivo('cliente_ausente');
      await carregarFila();

      toast.info(`Parada ${naoEntregue.sequencia} devolvida à fila`, {
        description:
          'O pedido mantém a posição que já tinha — quem esperou uma tentativa frustrada não vai para o fim.',
      });
    } catch (e) {
      toast.error('Não foi possível registrar a não-entrega.', {
        description: mensagemDoBackend(e) ?? undefined,
      });
    } finally {
      setSalvandoNaoEntregue(false);
    }
  }

  async function finalizarLote() {
    if (!lote) return;
    setFinalizando(true);
    try {
      await api.patch(`/lotes/${lote.id}/finalizar`);
      toast.success(`Lote #${lote.id} finalizado.`);
      setLote(null);
      await carregarFila();
    } catch (e) {
      // O backend recusa finalizar com pendência (400) e explica o porquê. Um
      // "não foi possível" genérico esconderia justamente a instrução do que fazer.
      const msg = mensagemDoBackend(e);

      toast.error('Não foi possível finalizar o lote.', {
        description: msg ?? undefined,
        duration: msg ? 9000 : 5000,
      });
    } finally {
      setFinalizando(false);
    }
  }

  const itens = lote?.itens ?? [];
  const entregues = itens.filter((i) => i.entregue_em).length;
  const progresso = itens.length ? (entregues / itens.length) * 100 : 0;
  const loteConcluido = itens.length > 0 && entregues === itens.length;
  const pendentes = itens.length - entregues;
  const proxima = itens.find((i) => !i.entregue_em);

  const partida = coord(lote?.lat_partida, lote?.lng_partida);
  const paradas: ParadaMapa[] = itens.flatMap((it) => {
    const c = coord(it.pedido.lat, it.pedido.lng);
    if (!c) return [];
    return [
      {
        sequencia: it.sequencia,
        lat: c.lat,
        lng: c.lng,
        rotulo: it.pedido.cliente?.nome ?? `Pedido ${it.pedido.id}`,
        entregue: !!it.entregue_em,
      },
    ];
  });

  // Os totais do resumo só vêm na criação/reotimização; depois de um F5 somamos
  // os trechos já gravados em lote_pedidos.
  const distanciaTotal =
    lote?.rota?.distancia_total_m ?? somar(itens.map((i) => i.distancia_m));
  const tempoTotal =
    lote?.rota?.tempo_total_seg ?? somar(itens.map((i) => i.tempo_seg));

  const foraDaRota = itens.length - paradas.length;

  return (
    <AppShell
      titulo={`Olá, ${usuario?.nome?.split(' ')[0] ?? 'entregador'}`}
      descricao="Puxe um lote e siga a rota na ordem."
    >
      {/* Puxar da fila. Com um lote em curso, puxar outro não faz sentido. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="text-brand size-4" />
            Fila
          </CardTitle>
          <CardDescription>
            {totalFila === 0 ? (
              'Nenhum pedido aguardando no momento.'
            ) : (
              <>
                <span className="text-foreground tabular font-semibold">
                  {totalFila}
                </span>{' '}
                pedido{totalFila === 1 ? '' : 's'} aguardando entrega.
              </>
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {lote ? (
            <p className="text-muted-foreground text-sm">
              Você tem o lote <span className="font-medium">#{lote.id}</span> em
              andamento. Finalize-o para puxar outro.
            </p>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="qtd">Quantas entregas você quer fazer?</Label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label="Diminuir"
                    onClick={() => setQtd((q) => Math.max(1, q - 1))}
                    disabled={qtd <= 1}
                  >
                    <Minus className="size-4" />
                  </Button>
                  <Input
                    id="qtd"
                    type="number"
                    min={1}
                    max={50}
                    value={qtd}
                    onChange={(e) =>
                      setQtd(Math.min(50, Math.max(1, Number(e.target.value) || 1)))
                    }
                    className="tabular h-11 text-center text-lg font-semibold"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label="Aumentar"
                    onClick={() => setQtd((q) => Math.min(50, q + 1))}
                    disabled={qtd >= 50}
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>

              <Button
                size="lg"
                className="h-12 w-full text-base"
                onClick={puxarLote}
                disabled={puxando || totalFila === 0}
              >
                {puxando ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Puxando…
                  </>
                ) : (
                  <>
                    <Truck className="size-4" />
                    Puxar {qtd} da fila
                  </>
                )}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {lote && (
        <Card className="mt-6 gap-0 overflow-hidden py-0">
          <CardHeader className="border-b px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Lote #{lote.id}</CardTitle>
              <span
                className={cn(
                  'tabular rounded-full px-2.5 py-1 text-xs font-medium',
                  loteConcluido
                    ? 'bg-success-soft text-success-soft-foreground'
                    : 'bg-brand/10 text-brand',
                )}
              >
                {entregues} de {itens.length} entregue
                {entregues === 1 ? '' : 's'}
              </span>
            </div>

            {distanciaTotal != null && tempoTotal != null && (
              <p className="text-muted-foreground tabular mt-2 flex items-center gap-1.5 text-sm">
                <Navigation className="size-3.5" />
                {formatarDistancia(distanciaTotal)} · {formatarTempo(tempoTotal)}
                {lote.rota?.fonte === 'osrm' && (
                  <span className="text-muted-foreground/70 text-xs">
                    · rota otimizada
                  </span>
                )}
              </p>
            )}

            <Progress value={progresso} className="mt-3 h-1.5" />
          </CardHeader>

          <CardContent className="p-0">
            <div className="space-y-3 border-b p-5">
              {lote.rota?.fonte === 'haversine' && (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>Rota não otimizada</AlertTitle>
                  <AlertDescription>
                    O roteador está fora do ar. Esta ordem é uma estimativa em
                    linha reta e não segue as ruas — recalcule em alguns minutos.
                  </AlertDescription>
                </Alert>
              )}

              {foraDaRota > 0 && (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>
                    {foraDaRota} entrega{foraDaRota === 1 ? '' : 's'} fora da rota
                  </AlertTitle>
                  <AlertDescription>
                    O endereço não foi localizado no mapa, então{' '}
                    {foraDaRota === 1 ? 'ela foi jogada' : 'elas foram jogadas'}{' '}
                    para o fim da lista. Peça ao atendente para corrigir o
                    cadastro do cliente.
                  </AlertDescription>
                </Alert>
              )}

              {paradas.length > 0 ? (
                <Suspense
                  fallback={
                    <Skeleton className="h-64 w-full rounded-xl sm:h-80" />
                  }
                >
                  <MapaRota
                    partida={partida}
                    paradas={paradas}
                    className="h-64 w-full rounded-xl border sm:h-80"
                  />
                </Suspense>
              ) : (
                <div className="bg-muted/60 text-muted-foreground flex h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed">
                  <MapPin className="size-5" />
                  <span className="text-sm font-medium">Sem mapa</span>
                  <span className="text-xs">
                    Nenhuma entrega deste lote tem coordenadas.
                  </span>
                </div>
              )}
            </div>

            {loteConcluido ? (
              <EmptyState
                icone={PackageCheck}
                titulo="Lote concluído 🎉"
                descricao="Todas as entregas deste lote foram feitas. Finalize-o para puxar outro."
              />
            ) : (
              <ul className="divide-y">
                {itens.map((item) => {
                  const entregue = !!item.entregue_em;
                  const eProxima = proxima?.id === item.id;
                  const distancia = formatarDistancia(item.distancia_m);
                  const c = coord(item.pedido.lat, item.pedido.lng);

                  return (
                    <li
                      key={item.id}
                      className={cn(
                        'flex gap-3 p-4 transition-colors sm:px-5',
                        entregue && 'opacity-55',
                        // A próxima parada é a única que importa agora.
                        eProxima && 'bg-brand/5',
                      )}
                    >
                      <span
                        className={cn(
                          'tabular grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold',
                          entregue
                            ? 'bg-success text-white'
                            : eProxima
                              ? 'bg-brand text-brand-foreground'
                              : 'bg-muted text-muted-foreground',
                        )}
                      >
                        {entregue ? <Check className="size-4" /> : item.sequencia}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn('font-medium', entregue && 'line-through')}
                          >
                            {item.pedido.cliente?.nome ?? 'Cliente —'}
                          </span>
                          <PriorityBadge
                            prioridade={item.pedido.prioridade}
                            size="sm"
                          />
                          {eProxima && (
                            <span className="bg-brand/10 text-brand rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                              próxima
                            </span>
                          )}
                        </div>

                        <p className="text-muted-foreground mt-0.5 flex items-center gap-1 text-sm">
                          <MapPin className="size-3.5 shrink-0" />
                          <span className="truncate">
                            {item.pedido.cliente?.endereco ?? '—'}
                          </span>
                        </p>

                        {!c && (
                          <p className="text-destructive mt-0.5 text-xs">
                            sem coordenadas — fora da rota otimizada
                          </p>
                        )}

                        {item.pedido.observacao && (
                          <p className="text-muted-foreground mt-1 text-xs italic">
                            “{item.pedido.observacao}”
                          </p>
                        )}

                        <div className="mt-2.5 flex items-center gap-2">
                          {distancia && (
                            <span className="text-muted-foreground tabular flex items-center gap-1 text-xs">
                              <Navigation className="size-3" />
                              {distancia}
                            </span>
                          )}

                          {!entregue && (
                            <>
                              {c && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="ml-auto"
                                  asChild
                                >
                                  {/* Deep link do Google Maps: abre a navegação
                                      turn-by-turn sem exigir chave de API. */}
                                  <a
                                    href={`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}&travelmode=driving`}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <Navigation className="size-4" />
                                    Navegar
                                  </a>
                                </Button>
                              )}

                              <Button
                                size="sm"
                                variant={eProxima ? 'default' : 'outline'}
                                className={cn(!c && 'ml-auto')}
                                onClick={() => marcarEntregue(item)}
                                disabled={entregandoId === item.pedido.id}
                              >
                                {entregandoId === item.pedido.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Check className="size-4" />
                                )}
                                Entregar
                              </Button>

                              {/* A saída honesta pra quando a entrega não rola. Sem
                                  ela o entregador finaliza o lote assim mesmo e o
                                  pedido some do sistema. */}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                  setNaoEntregue(item);
                                  setMotivo('cliente_ausente');
                                  setObservacaoNE('');
                                }}
                                disabled={entregandoId === item.pedido.id}
                              >
                                <X className="size-4" />
                                Não entregue
                              </Button>
                            </>
                          )}

                          {entregue && (
                            <span className="text-success ml-auto flex items-center gap-1 text-xs font-medium">
                              <Check className="size-3.5" />
                              entregue
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="flex flex-wrap gap-2 border-t p-4 sm:px-5">
              <Button
                variant="outline"
                onClick={reotimizar}
                disabled={reotimizando || loteConcluido || paradas.length === 0}
              >
                {reotimizando ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Recalcular rota daqui
              </Button>

              {/* Trava por pendência — mas é só cortesia: quem RECUSA de verdade é
                  o backend (400). Eu já afirmei uma vez que "a UI não alcança" o
                  buraco, e estava errado: o `variant` só mudava a cor do botão e ele
                  seguia clicável. Interface não é defesa. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="ml-auto">
                    <Button
                      variant={loteConcluido ? 'default' : 'outline'}
                      onClick={finalizarLote}
                      disabled={finalizando || pendentes > 0}
                      className="w-full"
                    >
                      {finalizando ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <PackageCheck className="size-4" />
                      )}
                      Finalizar lote
                    </Button>
                  </span>
                </TooltipTrigger>
                {pendentes > 0 && (
                  <TooltipContent>
                    Resolva as {pendentes} parada(s) pendente(s) primeiro — marque
                    cada uma como entregue ou como não entregue.
                  </TooltipContent>
                )}
              </Tooltip>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!naoEntregue}
        onOpenChange={(aberto) => !aberto && setNaoEntregue(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Entrega não realizada</DialogTitle>
            <DialogDescription>
              {naoEntregue?.pedido.cliente?.nome ?? 'Cliente'} — parada{' '}
              {naoEntregue?.sequencia}. O pedido volta para a fila com o motivo
              registrado.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="motivo">O que aconteceu?</Label>
              <Select value={motivo} onValueChange={(v) => setMotivo(v as Motivo)}>
                <SelectTrigger id="motivo" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOTIVOS.map((m) => (
                    <SelectItem key={m.valor} value={m.valor}>
                      {m.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="obs-ne">
                Observação{' '}
                <span className="text-muted-foreground font-normal">(opcional)</span>
              </Label>
              <Textarea
                id="obs-ne"
                rows={2}
                maxLength={300}
                placeholder="Tocou 3x, ninguém atendeu…"
                value={observacaoNE}
                onChange={(e) => setObservacaoNE(e.target.value)}
              />
            </div>

            <p className="text-muted-foreground text-xs">
              O pedido mantém a posição que já tinha na fila — não vai para o fim.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setNaoEntregue(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={marcarNaoEntregue}
              disabled={salvandoNaoEntregue}
            >
              {salvandoNaoEntregue && <Loader2 className="size-4 animate-spin" />}
              Devolver à fila
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function somar(valores: Array<number | null>): number | null {
  const validos = valores.filter((v): v is number => v != null);
  return validos.length ? validos.reduce((a, b) => a + b, 0) : null;
}

/**
 * Lê o GPS do dispositivo. Se for negado, cai para a posição padrão da área de
 * operação (VITE_PARTIDA_PADRAO) — e NÃO para uma cidade aleatória: um ponto de
 * partida em outro estado faria o roteador montar uma rota de centenas de km.
 */
function obterPosicao(): Promise<{ lat: number; lng: number; preciso: boolean }> {
  const [lat, lng] = (
    import.meta.env.VITE_PARTIDA_PADRAO ?? '-3.7327,-38.5267'
  )
    .split(',')
    .map(Number);
  const PADRAO = { lat, lng, preciso: false };

  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(PADRAO);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          preciso: true,
        }),
      () => resolve(PADRAO),
      { enableHighAccuracy: true, timeout: 5000 },
    );
  });
}
