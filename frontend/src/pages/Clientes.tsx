import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Loader2,
  MapPin,
  MapPinOff,
  Pencil,
  Search,
  UserPlus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api';
import { paraPonto } from '@/lib/geo';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { EnderecoPicker } from '@/components/endereco-picker';
import { StatCard } from '@/components/stat-card';
import type { Ponto } from '@/components/mapa-ponto';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export interface Cliente {
  id: string;
  nome: string;
  telefone: string | null;
  endereco: string;
  /** string porque é DECIMAL no MySQL. null = fora da rota otimizada. */
  lat: string | null;
  lng: string | null;
  referencia: string | null;
  criado_em: string;
  /** Só vem no POST/PATCH: como o geocodificador entendeu o endereço. */
  geocodificado_como?: string | null;
}

const semLocalizacao = (c: Cliente) => c.lat == null || c.lng == null;

interface Rascunho {
  nome: string;
  telefone: string;
  endereco: string;
  referencia: string;
}

const RASCUNHO_VAZIO: Rascunho = {
  nome: '',
  telefone: '',
  endereco: '',
  referencia: '',
};

export function Clientes() {
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [busca, setBusca] = useState('');
  const [soSemLocal, setSoSemLocal] = useState(false);

  // Um só dialog serve pra criar e editar: os campos são idênticos, e duplicar o
  // formulário só criaria duas versões pra manter em sincronia.
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Cliente | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>(RASCUNHO_VAZIO);
  const [ponto, setPonto] = useState<Ponto | null>(null);
  // O picker decide: só é `true` quando o número foi achado no mapa OU o atendente
  // posicionou o pino na mão. Ponto de rua sem confirmação humana não salva.
  const [pontoConfiavel, setPontoConfiavel] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    try {
      const r = await api.get<Cliente[]>('/clientes');
      setClientes(r.data);
    } catch {
      setClientes([]);
      toast.error('Não foi possível carregar os clientes.');
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  function abrirNovo() {
    setEditando(null);
    setRascunho(RASCUNHO_VAZIO);
    setPonto(null);
    setAberto(true);
  }

  function abrirEdicao(c: Cliente) {
    setEditando(c);
    setRascunho({
      nome: c.nome,
      telefone: c.telefone ?? '',
      endereco: c.endereco,
      referencia: c.referencia ?? '',
    });
    setPonto(paraPonto(c.lat, c.lng));
    setAberto(true);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);

    // Mandamos SEMPRE o lat/lng que o atendente confirmou no mapa. Se deixássemos
    // o backend geocodificar sozinho, ele pegaria o primeiro resultado — que é
    // exatamente o caminho que leva a coordenada certa na cidade errada.
    const corpo = {
      nome: rascunho.nome.trim(),
      telefone: rascunho.telefone.trim() || undefined,
      endereco: rascunho.endereco.trim(),
      referencia: rascunho.referencia.trim() || undefined,
      ...(ponto ? { lat: ponto.lat, lng: ponto.lng } : {}),
    };

    try {
      const r = editando
        ? await api.patch<Cliente>(`/clientes/${editando.id}`, corpo)
        : await api.post<Cliente>('/clientes', corpo);

      await carregar();
      setAberto(false);

      if (semLocalizacao(r.data)) {
        toast.warning(`"${r.data.nome}" ficou sem localização`, {
          description:
            'Os pedidos dele vão para o fim da rota do entregador. Edite e marque o ponto no mapa.',
          duration: 10000,
        });
      } else {
        toast.success(
          editando ? `Cliente "${r.data.nome}" atualizado` : `Cliente "${r.data.nome}" cadastrado`,
          { description: r.data.geocodificado_como ?? undefined },
        );
      }
    } catch {
      toast.error(
        editando
          ? 'Não foi possível atualizar o cliente.'
          : 'Não foi possível cadastrar o cliente.',
      );
    } finally {
      setSalvando(false);
    }
  }

  const lista = clientes ?? [];
  const semLocal = lista.filter(semLocalizacao).length;

  const filtrados = useMemo(() => {
    // Busca é client-side de propósito: GET /clientes devolve a base inteira e
    // não aceita ?q=. Se a base crescer muito, pedimos paginação ao backend.
    const q = busca.trim().toLowerCase();
    return lista.filter((c) => {
      if (soSemLocal && !semLocalizacao(c)) return false;
      if (!q) return true;
      return (
        c.nome.toLowerCase().includes(q) ||
        c.endereco.toLowerCase().includes(q) ||
        (c.telefone ?? '').toLowerCase().includes(q)
      );
    });
  }, [lista, busca, soSemLocal]);

  const carregando = clientes === null;
  const rascunhoValido =
    rascunho.nome.trim().length > 0 && rascunho.endereco.trim().length > 0;

  return (
    <AppShell
      titulo="Clientes"
      descricao="Cadastro e localização — é daqui que sai a rota do entregador."
      acoes={
        <Button size="sm" onClick={abrirNovo}>
          <UserPlus className="size-4" />
          Novo cliente
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <StatCard
          rotulo="Clientes"
          valor={lista.length}
          icone={Users}
          tone="brand"
          carregando={carregando}
        />
        <StatCard
          rotulo="Sem localização"
          valor={semLocal}
          icone={MapPinOff}
          tone={semLocal > 0 ? 'urgente' : 'normal'}
          carregando={carregando}
        />
      </div>

      <Card className="mt-6 gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-4">
          <div className="relative min-w-56 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Buscar por nome, telefone ou endereço…"
              className="pl-9"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          {/* Atalho pro trabalho que importa: consertar quem está fora da rota. */}
          <Button
            variant={soSemLocal ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSoSemLocal((v) => !v)}
            disabled={semLocal === 0 && !soSemLocal}
          >
            <MapPinOff className="size-4" />
            Só sem localização
            {semLocal > 0 && (
              <span className="tabular ml-1 opacity-70">({semLocal})</span>
            )}
          </Button>
        </div>

        <CardContent className="p-0">
          {carregando ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtrados.length === 0 ? (
            <EmptyState
              icone={Users}
              titulo={lista.length === 0 ? 'Nenhum cliente ainda' : 'Nada encontrado'}
              descricao={
                lista.length === 0
                  ? 'Cadastre o primeiro cliente para começar a lançar pedidos.'
                  : 'Ajuste a busca ou o filtro.'
              }
              acao={
                lista.length === 0 ? (
                  <Button onClick={abrirNovo}>
                    <UserPlus className="size-4" />
                    Novo cliente
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Cliente</TableHead>
                  <TableHead>Endereço</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead className="pr-5 text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((c) => {
                  const perdido = semLocalizacao(c);
                  return (
                    <TableRow key={c.id} className={cn(perdido && 'bg-urgente-soft/30')}>
                      <TableCell className="pl-5">
                        <div className="font-medium">{c.nome}</div>
                        {c.telefone && (
                          <div className="text-muted-foreground tabular text-xs">
                            {c.telefone}
                          </div>
                        )}
                      </TableCell>

                      <TableCell className="text-muted-foreground max-w-xs">
                        <div className="truncate text-sm">{c.endereco}</div>
                        {c.referencia && (
                          <div className="truncate text-xs italic">{c.referencia}</div>
                        )}
                      </TableCell>

                      <TableCell>
                        {perdido ? (
                          <span className="bg-urgente-soft text-urgente-soft-foreground border-urgente/25 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                            <MapPinOff className="size-3" />
                            fora da rota
                          </span>
                        ) : (
                          <span className="bg-success-soft text-success-soft-foreground border-success/25 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                            <MapPin className="size-3" />
                            no mapa
                          </span>
                        )}
                      </TableCell>

                      <TableCell className="pr-5 text-right">
                        <Button
                          variant={perdido ? 'default' : 'ghost'}
                          size="sm"
                          onClick={() => abrirEdicao(c)}
                        >
                          <Pencil className="size-3.5" />
                          {perdido ? 'Localizar' : 'Editar'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={salvar}>
            <DialogHeader>
              <DialogTitle>
                {editando ? `Editar ${editando.nome}` : 'Cadastrar cliente'}
              </DialogTitle>
              <DialogDescription>
                Confirme o ponto no mapa — é ele que define a rota do entregador.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="nome">Nome</Label>
                  <Input
                    id="nome"
                    autoFocus
                    maxLength={120}
                    value={rascunho.nome}
                    onChange={(e) =>
                      setRascunho({ ...rascunho, nome: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="telefone">
                    Telefone{' '}
                    <span className="text-muted-foreground font-normal">
                      (opcional)
                    </span>
                  </Label>
                  <Input
                    id="telefone"
                    type="tel"
                    inputMode="tel"
                    maxLength={20}
                    placeholder="(85) 90000-0000"
                    value={rascunho.telefone}
                    onChange={(e) =>
                      setRascunho({ ...rascunho, telefone: e.target.value })
                    }
                  />
                </div>
              </div>

              <EnderecoPicker
                endereco={rascunho.endereco}
                onEnderecoChange={(endereco) => setRascunho({ ...rascunho, endereco })}
                ponto={ponto}
                onPontoChange={setPonto}
                onPodeSalvarChange={setPontoConfiavel}
              />

              <div className="space-y-2">
                <Label htmlFor="referencia">
                  Referência{' '}
                  <span className="text-muted-foreground font-normal">(opcional)</span>
                </Label>
                <Input
                  id="referencia"
                  maxLength={255}
                  placeholder="Portão azul, ao lado da padaria…"
                  value={rascunho.referencia}
                  onChange={(e) =>
                    setRascunho({ ...rascunho, referencia: e.target.value })
                  }
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={salvando || !rascunhoValido || !pontoConfiavel}
              >
                {salvando && <Loader2 className="size-4 animate-spin" />}
                {editando ? 'Salvar alterações' : 'Cadastrar cliente'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
