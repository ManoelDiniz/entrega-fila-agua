import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  Minus,
  Plus,
  Send,
  UserPlus,
  AlertTriangle,
  Crown,
  Circle,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api';
import { AppShell } from '@/components/app-shell';
import { EnderecoPicker } from '@/components/endereco-picker';
import type { Ponto } from '@/components/mapa-ponto';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';

interface Cliente {
  id: string;
  nome: string;
  endereco: string;
  /** Sem coordenadas, o pedido fica de fora da rota otimizada do entregador. */
  lat: string | null;
  lng: string | null;
  /** Só vem na criação: o endereço como o geocodificador o entendeu. */
  geocodificado_como?: string | null;
}

const semCoordenadas = (c: Pick<Cliente, 'lat' | 'lng'>) =>
  c.lat == null || c.lng == null;

interface Produto {
  id: string;
  nome: string;
  preco: string;
  ativo: number;
}

const PRIORIDADES = [
  {
    valor: 'normal',
    rotulo: 'Normal',
    ajuda: 'Entra na ordem de chegada',
    icone: Circle,
    cor: 'text-normal',
  },
  {
    valor: 'vip',
    rotulo: 'VIP',
    ajuda: 'Passa à frente dos normais',
    icone: Crown,
    cor: 'text-vip',
  },
  {
    valor: 'urgente',
    rotulo: 'Urgente',
    ajuda: 'Vai para o topo da fila',
    icone: AlertTriangle,
    cor: 'text-urgente',
  },
] as const;

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function Atendente() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);

  // --- Novo pedido ---
  const [clienteId, setClienteId] = useState('');
  const [prioridade, setPrioridade] = useState('normal');
  const [produtoId, setProdutoId] = useState('');
  const [quantidade, setQuantidade] = useState(1);
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);

  // --- Novo cliente ---
  const [dialogAberto, setDialogAberto] = useState(false);
  const [novoCliente, setNovoCliente] = useState({
    nome: '',
    telefone: '',
    endereco: '',
  });
  const [pontoNovoCliente, setPontoNovoCliente] = useState<Ponto | null>(null);
  const [pontoConfiavel, setPontoConfiavel] = useState(false);
  const [salvandoCliente, setSalvandoCliente] = useState(false);

  async function carregarClientes() {
    const r = await api.get<Cliente[]>('/clientes');
    setClientes(r.data);
    return r.data;
  }

  useEffect(() => {
    carregarClientes().catch(() =>
      toast.error('Não foi possível carregar os clientes.'),
    );

    // ?ativo=1: o seletor de venda mostra só o que está à venda hoje. Produto
    // desativado continua existindo (e no histórico), mas não pode ser vendido.
    api
      .get<Produto[]>('/produtos', { params: { ativo: 1 } })
      .then((r) => setProdutos(Array.isArray(r.data) ? r.data : []))
      .catch(() => toast.error('Não foi possível carregar os produtos.'));
  }, []);

  const produto = produtos.find((p) => p.id === produtoId);
  const total = produto ? Number(produto.preco) * quantidade : 0;
  const cliente = clientes.find((c) => c.id === clienteId);

  async function criarCliente(e: FormEvent) {
    e.preventDefault();
    setSalvandoCliente(true);
    try {
      // Manda o ponto que o atendente CONFIRMOU no mapa. Sem isso o backend
      // geocodifica sozinho e fica com o primeiro palpite — que é justamente
      // como "Av. Central" sem cidade vai parar em Gramado, a 3.000 km.
      const r = await api.post<Cliente>('/clientes', {
        ...novoCliente,
        ...(pontoNovoCliente
          ? { lat: pontoNovoCliente.lat, lng: pontoNovoCliente.lng }
          : {}),
      });
      await carregarClientes();
      // Já deixa o cliente novo selecionado — o atendente veio pra fazer o pedido.
      setClienteId(r.data.id);
      setNovoCliente({ nome: '', telefone: '', endereco: '' });
      setPontoNovoCliente(null);
      setDialogAberto(false);

      if (semCoordenadas(r.data)) {
        // Falha visível de propósito: o pedido até entra na fila, mas fica fora
        // da rota otimizada e o entregador o recebe no fim da lista.
        toast.warning(`"${r.data.nome}" ficou sem localização`, {
          description:
            'O endereço não foi encontrado no mapa. Refaça o cadastro com rua, número, bairro e cidade — senão as entregas dele ficam fora da rota.',
          duration: 10000,
        });
      } else {
        // Mostra o endereço COMO O GEOCODIFICADOR ENTENDEU: um endereço vago
        // casa com rua homônima em outra cidade, e só o atendente sabe conferir.
        toast.success(`Cliente "${r.data.nome}" cadastrado`, {
          description: r.data.geocodificado_como
            ? `Localizado em: ${r.data.geocodificado_como}. Confira se é o endereço certo.`
            : 'Já selecionado no pedido.',
          duration: 8000,
        });
      }
    } catch {
      toast.error('Não foi possível cadastrar o cliente.');
    } finally {
      setSalvandoCliente(false);
    }
  }

  async function criarPedido(e: FormEvent) {
    e.preventDefault();
    if (!clienteId || !produtoId) {
      toast.warning('Selecione o cliente e o produto.');
      return;
    }

    setEnviando(true);
    try {
      await api.post('/pedidos', {
        cliente_id: clienteId,
        prioridade,
        observacao: observacao || undefined,
        itens: [{ produto_id: produtoId, quantidade }],
      });
      toast.success('Pedido enviado para a fila', {
        description: `${cliente?.nome} · ${quantidade}× ${produto?.nome} · ${brl.format(total)}`,
      });
      // Limpa o pedido, mas mantém o cliente: é comum lançar vários seguidos.
      setObservacao('');
      setQuantidade(1);
      setProdutoId('');
      setPrioridade('normal');
    } catch {
      toast.error('Não foi possível enviar o pedido.');
    } finally {
      setEnviando(false);
    }
  }

  // Exige o ponto confiável (número achado, ou pino posicionado pelo atendente).
  // Sem isso o cadastro rápido daqui viraria o buraco por onde entram os clientes
  // com pino no meio da rua — exatamente o que a tela de Clientes já barra.
  const clienteNovoValido =
    novoCliente.nome.trim().length > 0 &&
    novoCliente.endereco.trim().length > 0 &&
    pontoConfiavel;

  return (
    <AppShell
      titulo="Registrar pedido"
      descricao="Lance o pedido e ele entra na fila na hora."
      acoes={
        <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              <UserPlus className="size-4" />
              Novo cliente
            </Button>
          </DialogTrigger>

          <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
            <form onSubmit={criarCliente}>
              <DialogHeader>
                <DialogTitle>Cadastrar cliente</DialogTitle>
                <DialogDescription>
                  Ao salvar, o cliente já fica selecionado no pedido.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-5">
                <div className="space-y-2">
                  <Label htmlFor="c-nome">Nome</Label>
                  <Input
                    id="c-nome"
                    autoFocus
                    value={novoCliente.nome}
                    onChange={(e) =>
                      setNovoCliente({ ...novoCliente, nome: e.target.value })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="c-tel">
                    Telefone{' '}
                    <span className="text-muted-foreground font-normal">
                      (opcional)
                    </span>
                  </Label>
                  <Input
                    id="c-tel"
                    type="tel"
                    inputMode="tel"
                    placeholder="(11) 90000-0000"
                    value={novoCliente.telefone}
                    onChange={(e) =>
                      setNovoCliente({ ...novoCliente, telefone: e.target.value })
                    }
                  />
                </div>

                <EnderecoPicker
                  endereco={novoCliente.endereco}
                  onEnderecoChange={(endereco) =>
                    setNovoCliente({ ...novoCliente, endereco })
                  }
                  ponto={pontoNovoCliente}
                  onPontoChange={setPontoNovoCliente}
                  onPodeSalvarChange={setPontoConfiavel}
                />
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setDialogAberto(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={salvandoCliente || !clienteNovoValido}>
                  {salvandoCliente && <Loader2 className="size-4 animate-spin" />}
                  Salvar cliente
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr] lg:items-start">
        <Card>
          <CardHeader>
            <CardTitle>Novo pedido</CardTitle>
            <CardDescription>
              Cliente, produto e prioridade. O resto é com a fila.
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form id="form-pedido" onSubmit={criarPedido} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="cliente">Cliente</Label>
                <Select value={clienteId} onValueChange={setClienteId}>
                  <SelectTrigger id="cliente" className="w-full">
                    <SelectValue placeholder="Selecione o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clientes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex flex-col items-start">
                          <span className="flex items-center gap-1.5 font-medium">
                            {semCoordenadas(c) && (
                              <AlertTriangle className="text-destructive size-3.5 shrink-0" />
                            )}
                            {c.nome}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            {c.endereco}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {clientes.length === 0 && (
                  <p className="text-muted-foreground text-xs">
                    Nenhum cliente ainda — cadastre um em “Novo cliente”.
                  </p>
                )}
                {cliente && semCoordenadas(cliente) && (
                  <Alert variant="destructive">
                    <AlertTriangle />
                    <AlertTitle>Cliente sem localização no mapa</AlertTitle>
                    <AlertDescription>
                      O pedido entra na fila normalmente, mas fica de fora da rota
                      otimizada e chega ao entregador no fim da lista.{' '}
                      <Link to="/clientes" className="font-medium underline underline-offset-4">
                        Marque o ponto no mapa
                      </Link>{' '}
                      para resolver.
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="space-y-2">
                <Label>Prioridade</Label>
                {/* Radio em forma de cartões: o atendente escolhe no olho, sem abrir menu. */}
                <div className="grid grid-cols-3 gap-2">
                  {PRIORIDADES.map(({ valor, rotulo, ajuda, icone: Icone, cor }) => {
                    const ativo = prioridade === valor;
                    return (
                      <button
                        key={valor}
                        type="button"
                        onClick={() => setPrioridade(valor)}
                        aria-pressed={ativo}
                        className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                          ativo
                            ? 'border-brand bg-brand/5 ring-brand/20 ring-2'
                            : 'hover:bg-accent/50 border-border'
                        }`}
                      >
                        <Icone className={`size-4 ${cor}`} />
                        <span className="text-sm font-medium">{rotulo}</span>
                        <span className="text-muted-foreground hidden text-[11px] leading-tight sm:block">
                          {ajuda}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                <div className="space-y-2">
                  <Label htmlFor="produto">Produto</Label>
                  <Select value={produtoId} onValueChange={setProdutoId}>
                    <SelectTrigger id="produto" className="w-full">
                      <SelectValue placeholder="Selecione o produto" />
                    </SelectTrigger>
                    <SelectContent>
                      {produtos.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.nome} — {brl.format(Number(p.preco))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {produtos.length === 0 && (
                    <p className="text-muted-foreground text-xs">
                      Nenhum produto ativo —{' '}
                      <Link to="/produtos" className="text-brand underline underline-offset-4">
                        cadastre um produto
                      </Link>{' '}
                      antes de lançar pedidos.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="qtd">Quantidade</Label>
                  {/* Stepper: alvo grande, pensado pra tela de toque no balcão. */}
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Diminuir quantidade"
                      onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
                      disabled={quantidade <= 1}
                    >
                      <Minus className="size-4" />
                    </Button>
                    <Input
                      id="qtd"
                      type="number"
                      min={1}
                      max={99}
                      value={quantidade}
                      onChange={(e) =>
                        setQuantidade(
                          Math.min(99, Math.max(1, Number(e.target.value) || 1)),
                        )
                      }
                      className="tabular w-16 text-center"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Aumentar quantidade"
                      onClick={() => setQuantidade((q) => Math.min(99, q + 1))}
                      disabled={quantidade >= 99}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="obs">
                  Observação{' '}
                  <span className="text-muted-foreground font-normal">(opcional)</span>
                </Label>
                <Textarea
                  id="obs"
                  rows={2}
                  placeholder="Ex.: deixar na portaria, tocar o interfone…"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                />
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Resumo: confirma o que vai pra fila antes de enviar. */}
        <Card className="lg:sticky lg:top-20">
          <CardHeader>
            <CardTitle>Resumo</CardTitle>
            <CardDescription>Confira antes de enviar.</CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Cliente</dt>
                <dd className="max-w-[60%] truncate text-right font-medium">
                  {cliente?.nome ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Endereço</dt>
                <dd className="text-muted-foreground max-w-[60%] truncate text-right text-xs">
                  {cliente?.endereco ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Produto</dt>
                <dd className="max-w-[60%] truncate text-right font-medium">
                  {produto ? `${quantidade}× ${produto.nome}` : '—'}
                </dd>
              </div>
            </dl>

            <Separator />

            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground text-sm">Total</span>
              <span className="tabular text-2xl font-semibold tracking-tight">
                {brl.format(total)}
              </span>
            </div>

            <Button
              type="submit"
              form="form-pedido"
              size="lg"
              className="w-full"
              disabled={enviando || !clienteId || !produtoId}
            >
              {enviando ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Enviando…
                </>
              ) : (
                <>
                  <Send className="size-4" />
                  Enviar para a fila
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
