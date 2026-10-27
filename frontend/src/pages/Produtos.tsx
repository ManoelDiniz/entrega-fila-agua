import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Info,
  Loader2,
  Package,
  PackageCheck,
  Pencil,
  Plus,
  Power,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api';
import type { Perfil } from '@/auth';
import { useAuth } from '@/auth';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { StatCard } from '@/components/stat-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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

export interface Produto {
  id: string;
  nome: string;
  /** string porque é DECIMAL no MySQL — envie number, leia string. */
  preco: string;
  /** TINYINT 0|1, não boolean — envie boolean, leia 0|1. */
  ativo: number;
}

/**
 * Quem pode criar/editar/desativar produto. Espelha o @Roles do
 * ProdutosController — se divergir, o botão aparece e o backend responde 403.
 * O entregador lê a lista (a entrega mostra os itens), mas não gerencia.
 */
const PERFIS_GESTAO_PRODUTOS: Perfil[] = ['admin', 'atendente'];

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function Produtos() {
  const { usuario } = useAuth();
  const podeGerenciar = !!usuario && PERFIS_GESTAO_PRODUTOS.includes(usuario.perfil);

  const [produtos, setProdutos] = useState<Produto[] | null>(null);
  const [busca, setBusca] = useState('');

  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<Produto | null>(null);
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [alternandoId, setAlternandoId] = useState<string | null>(null);

  async function carregar() {
    try {
      // Sem ?ativos=1: esta é a tela de gestão, precisa mostrar os desativados
      // pra poder reativá-los. O filtro de ativos é da tela de PEDIDO.
      const r = await api.get<Produto[]>('/produtos');
      setProdutos(r.data);
    } catch {
      setProdutos([]);
      toast.error('Não foi possível carregar os produtos.');
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  function abrirNovo() {
    setEditando(null);
    setNome('');
    setPreco('');
    setAberto(true);
  }

  function abrirEdicao(p: Produto) {
    setEditando(p);
    setNome(p.nome);
    setPreco(p.preco);
    setAberto(true);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();

    const valor = Number(preco.replace(',', '.'));
    if (!Number.isFinite(valor) || valor < 0) {
      toast.warning('Informe um preço válido.');
      return;
    }

    setSalvando(true);
    try {
      // `preco` vai como number mesmo vindo de <input> (string). O DTO é @IsNumber.
      const corpo = { nome: nome.trim(), preco: valor };
      const r = editando
        ? await api.patch<Produto>(`/produtos/${editando.id}`, corpo)
        : await api.post<Produto>('/produtos', corpo);

      await carregar();
      setAberto(false);
      toast.success(
        editando ? `"${r.data.nome}" atualizado` : `"${r.data.nome}" cadastrado`,
      );
    } catch {
      toast.error(
        editando
          ? 'Não foi possível atualizar o produto.'
          : 'Não foi possível cadastrar o produto.',
      );
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(p: Produto) {
    setAlternandoId(p.id);
    try {
      // Não existe DELETE de produto, de propósito: produto já vendido está
      // referenciado em pedido_itens (FK RESTRICT) e apagá-lo levaria o histórico
      // do pedido junto. Desativar é um PATCH — some da venda, o passado fica.
      await api.patch(`/produtos/${p.id}`, { ativo: p.ativo ? 0 : 1 });

      toast.success(p.ativo ? `"${p.nome}" desativado` : `"${p.nome}" reativado`, {
        description: p.ativo
          ? 'Some do seletor de pedido, mas o histórico continua.'
          : undefined,
      });
      await carregar();
    } catch {
      toast.error('Não foi possível alterar o produto.');
    } finally {
      setAlternandoId(null);
    }
  }

  const lista = produtos ?? [];
  const ativos = lista.filter((p) => p.ativo).length;

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((p) => p.nome.toLowerCase().includes(q));
  }, [lista, busca]);

  const carregando = produtos === null;

  return (
    <AppShell
      titulo="Produtos"
      descricao="O que a equipe pode vender e por quanto."
      acoes={
        podeGerenciar ? (
          <Button size="sm" onClick={abrirNovo}>
            <Plus className="size-4" />
            Novo produto
          </Button>
        ) : undefined
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <StatCard
          rotulo="Ativos"
          valor={ativos}
          icone={PackageCheck}
          tone="brand"
          carregando={carregando}
        />
        <StatCard
          rotulo="Desativados"
          valor={lista.length - ativos}
          icone={Package}
          tone="normal"
          carregando={carregando}
        />
      </div>

      {!podeGerenciar && !carregando && (
        <Alert className="mt-6">
          <Info className="size-4" />
          <AlertTitle>Somente leitura</AlertTitle>
          <AlertDescription>
            Seu perfil pode consultar os preços, mas o cadastro de produto é do
            administrador.
          </AlertDescription>
        </Alert>
      )}

      {podeGerenciar && (
        <Alert className="mt-6">
          <Info className="size-4" />
          <AlertTitle>Mudar o preço não altera pedidos já feitos</AlertTitle>
          <AlertDescription>
            Cada pedido guarda o preço do momento da venda. O preço novo vale só para
            os próximos — o histórico financeiro não muda sozinho.
          </AlertDescription>
        </Alert>
      )}

      <Card className="mt-6 gap-0 overflow-hidden py-0">
        <div className="border-b p-4">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Buscar produto…"
              className="pl-9"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
        </div>

        <CardContent className="p-0">
          {carregando ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtrados.length === 0 ? (
            <EmptyState
              icone={Package}
              titulo={lista.length === 0 ? 'Nenhum produto' : 'Nada encontrado'}
              descricao={
                lista.length === 0
                  ? 'Cadastre o que a equipe vende para o atendente poder lançar pedidos.'
                  : 'Ajuste a busca.'
              }
              acao={
                lista.length === 0 && podeGerenciar ? (
                  <Button onClick={abrirNovo}>
                    <Plus className="size-4" />
                    Novo produto
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-5">Produto</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead>Situação</TableHead>
                  {podeGerenciar && (
                    <TableHead className="pr-5 text-right">Ações</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtrados.map((p) => {
                  const inativo = !p.ativo;
                  return (
                    <TableRow key={p.id} className={cn(inativo && 'opacity-60')}>
                      <TableCell className="pl-5 font-medium">{p.nome}</TableCell>

                      <TableCell className="tabular text-right">
                        {brl.format(Number(p.preco))}
                      </TableCell>

                      <TableCell>
                        {inativo ? (
                          <span className="bg-normal-soft text-normal-soft-foreground border-normal/20 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                            desativado
                          </span>
                        ) : (
                          <span className="bg-success-soft text-success-soft-foreground border-success/25 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium">
                            ativo
                          </span>
                        )}
                      </TableCell>

                      {podeGerenciar && (
                        <TableCell className="pr-5 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => abrirEdicao(p)}
                            >
                              <Pencil className="size-3.5" />
                              Editar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => alternarAtivo(p)}
                              disabled={alternandoId === p.id}
                              className={cn(
                                !inativo &&
                                  'text-destructive hover:text-destructive hover:bg-destructive/10',
                              )}
                            >
                              {alternandoId === p.id ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Power className="size-3.5" />
                              )}
                              {inativo ? 'Reativar' : 'Desativar'}
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="sm:max-w-sm">
          <form onSubmit={salvar}>
            <DialogHeader>
              <DialogTitle>
                {editando ? `Editar ${editando.nome}` : 'Cadastrar produto'}
              </DialogTitle>
              <DialogDescription>
                Produtos ativos aparecem no seletor do atendente.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-5">
              <div className="space-y-2">
                <Label htmlFor="p-nome">Nome</Label>
                <Input
                  id="p-nome"
                  autoFocus
                  maxLength={120}
                  placeholder="Galão de Água 20L"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="p-preco">Preço (R$)</Label>
                <Input
                  id="p-preco"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  placeholder="12.00"
                  className="tabular"
                  value={preco}
                  onChange={(e) => setPreco(e.target.value)}
                  required
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setAberto(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={salvando || !nome.trim() || preco === ''}
              >
                {salvando && <Loader2 className="size-4 animate-spin" />}
                {editando ? 'Salvar' : 'Cadastrar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
