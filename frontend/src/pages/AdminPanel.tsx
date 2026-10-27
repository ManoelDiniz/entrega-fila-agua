import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Circle,
  Crown,
  Inbox,
  Layers,
  PackageCheck,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/api';
import { getSocket, subscribe } from '@/socket';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PriorityBadge } from '@/components/priority-badge';
import { StatCard } from '@/components/stat-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PedidoFila {
  id: string;
  prioridade: string;
  status: string;
  valor_total: string;
  criado_em: string;
  cliente?: { nome: string };
}

interface FilaResp {
  contagem: { normal: number; vip: number; urgente: number; total: number };
  pedidos: PedidoFila[];
}

interface LoteEvento {
  id: string;
  hora: string;
}

const CONTAGEM_ZERO = { normal: 0, vip: 0, urgente: 0, total: 0 };

function horaAgora() {
  return new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function AdminPanel() {
  const [fila, setFila] = useState<FilaResp | null>(null);
  const [lotes, setLotes] = useState<LoteEvento[]>([]);
  const [atualizando, setAtualizando] = useState(false);
  const [ultimaAtualizacao, setUltimaAtualizacao] = useState<string | null>(null);

  const carregarFila = useCallback(async () => {
    setAtualizando(true);
    try {
      const r = await api.get<FilaResp>('/fila');
      setFila(r.data);
      setUltimaAtualizacao(horaAgora());
    } finally {
      setAtualizando(false);
    }
  }, []);

  useEffect(() => {
    carregarFila();

    // Atualização ao vivo via Socket.io.
    subscribe('admin');
    const socket = getSocket();
    const onFila = () => carregarFila();
    const onLote = (p: { loteId: string }) =>
      setLotes((prev) => [{ id: p.loteId, hora: horaAgora() }, ...prev].slice(0, 20));

    socket.on('fila:atualizada', onFila);
    socket.on('pedido:novo', onFila);
    socket.on('lote:criado', onLote);

    return () => {
      socket.off('fila:atualizada', onFila);
      socket.off('pedido:novo', onFila);
      socket.off('lote:criado', onLote);
    };
  }, [carregarFila]);

  const c = fila?.contagem ?? CONTAGEM_ZERO;
  const carregandoInicial = fila === null;
  const pedidos = fila?.pedidos ?? [];

  return (
    <AppShell
      titulo="Painel do Admin"
      descricao={
        ultimaAtualizacao
          ? `Fila em tempo real · atualizado às ${ultimaAtualizacao}`
          : 'Fila em tempo real'
      }
      acoes={
        <Button
          variant="outline"
          size="sm"
          onClick={carregarFila}
          disabled={atualizando}
        >
          <RefreshCw className={atualizando ? 'size-4 animate-spin' : 'size-4'} />
          Atualizar
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          rotulo="Na fila"
          valor={c.total}
          icone={Inbox}
          tone="brand"
          aoVivo
          carregando={carregandoInicial}
        />
        <StatCard
          rotulo="Urgente"
          valor={c.urgente}
          icone={AlertTriangle}
          tone="urgente"
          carregando={carregandoInicial}
        />
        <StatCard
          rotulo="VIP"
          valor={c.vip}
          icone={Crown}
          tone="vip"
          carregando={carregandoInicial}
        />
        <StatCard
          rotulo="Normal"
          valor={c.normal}
          icone={Circle}
          tone="normal"
          carregando={carregandoInicial}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="flex flex-row items-center justify-between border-b px-5 py-4">
            <CardTitle className="text-base">Pedidos na fila</CardTitle>
            {!carregandoInicial && pedidos.length > 0 && (
              <span className="text-muted-foreground tabular text-xs">
                {pedidos.length} pedido{pedidos.length === 1 ? '' : 's'}
              </span>
            )}
          </CardHeader>

          <CardContent className="p-0">
            {carregandoInicial ? (
              <div className="space-y-3 p-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : pedidos.length === 0 ? (
              <EmptyState
                icone={PackageCheck}
                titulo="Fila vazia"
                descricao="Todos os pedidos já foram puxados. Novos pedidos aparecem aqui automaticamente."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-16 pl-5">#</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead className="pr-5 text-right">Criado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pedidos.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="tabular text-muted-foreground pl-5 font-medium">
                        {p.id}
                      </TableCell>
                      <TableCell className="font-medium">
                        {p.cliente?.nome ?? '—'}
                      </TableCell>
                      <TableCell>
                        <PriorityBadge prioridade={p.prioridade} />
                      </TableCell>
                      <TableCell className="tabular text-right">
                        R$ {p.valor_total}
                      </TableCell>
                      <TableCell className="tabular text-muted-foreground pr-5 text-right text-xs">
                        {new Date(p.criado_em).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="border-b px-5 py-4">
            <CardTitle className="text-base">Lotes puxados</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {lotes.length === 0 ? (
              <EmptyState
                icone={Layers}
                titulo="Nenhum lote ainda"
                descricao="Quando um entregador puxar da fila, o lote aparece aqui na hora."
              />
            ) : (
              <ul className="divide-y">
                {lotes.map((l, i) => (
                  <li
                    key={`${l.id}-${i}`}
                    className="flex items-center gap-3 px-5 py-3"
                  >
                    <span className="bg-brand/10 text-brand grid size-8 shrink-0 place-items-center rounded-lg">
                      <Layers className="size-4" />
                    </span>
                    <span className="flex-1 text-sm font-medium">Lote #{l.id}</span>
                    <span className="text-muted-foreground tabular text-xs">
                      {l.hora}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
