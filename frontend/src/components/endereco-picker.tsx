import { lazy, Suspense, useEffect, useState } from 'react';
import { Check, Loader2, MapPin, Search, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  buscarArea,
  buscarCep,
  buscarEnderecos,
  rotularCandidato,
  type AreaOperacao,
  type CandidatoEndereco,
} from '@/lib/geo';
import type { Ponto } from '@/components/mapa-ponto';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const MapaPonto = lazy(() =>
  import('@/components/mapa-ponto').then((m) => ({ default: m.MapaPonto })),
);

interface Props {
  endereco: string;
  onEnderecoChange: (v: string) => void;
  ponto: Ponto | null;
  onPontoChange: (p: Ponto | null) => void;
  /**
   * Sobe para o formulário se o ponto pode ser salvo.
   *
   * É `false` enquanto o ponto não for confiável — ou seja, enquanto o
   * geocodificador não achar o número E o atendente não posicionar o pino na mão.
   */
  onPodeSalvarChange: (ok: boolean) => void;
}


/**
 * Endereço → coordenada, com duas defesas contra mentira silenciosa.
 *
 * 1) O geocodificador ACERTA NO LUGAR ERRADO. Endereço sem cidade casa com via
 *    homônima a 3.000 km. Por isso: CEP resolve a rua certa, e a busca devolve
 *    VÁRIOS candidatos para o atendente escolher.
 *
 * 2) O geocodificador DESCARTA O NÚMERO em silêncio. Casa residencial quase nunca
 *    está mapeada no OpenStreetMap — então ele devolve a RUA e a tela antiga dizia
 *    "localização confirmada", com o pino em algum ponto de uma via de 800 metros.
 *    Por isso: `precisao !== 'casa'` bloqueia o salvamento até o atendente arrastar
 *    o pino até a casa.
 *
 * O pino arrastável deixou de ser um extra. Virou o mecanismo principal de precisão.
 */
export function EnderecoPicker({
  endereco,
  onEnderecoChange,
  ponto,
  onPontoChange,
  onPodeSalvarChange,
}: Props) {
  const [cep, setCep] = useState('');
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [numero, setNumero] = useState('');
  // Partes vindas do CEP — quando existem, o endereço é recomposto a partir delas.
  const [partes, setPartes] = useState<{
    logradouro: string;
    bairro: string;
    cidade: string;
    uf: string;
  } | null>(null);

  const [area, setArea] = useState<AreaOperacao | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [candidatos, setCandidatos] = useState<CandidatoEndereco[] | null>(null);
  const [escolhido, setEscolhido] = useState<CandidatoEndereco | null>(null);
  /** O atendente moveu o pino na mão — é isso que torna um ponto impreciso confiável. */
  const [ajustado, setAjustado] = useState(false);

  const precisao = escolhido?.precisao ?? null;
  const exato = precisao === 'casa';

  /**
   * Ponto confiável quando:
   *  - o provedor achou o NÚMERO (`casa`), ou
   *  - uma pessoa posicionou o pino, ou
   *  - o ponto já veio salvo do banco e ninguém buscou nada (`candidatos === null`).
   *
   * O terceiro caso existe pra não punir quem abriu a edição só pra trocar o
   * telefone: o ponto dele é o que já estava lá, e exigir reconfirmação
   * transformaria uma trava útil num pedágio.
   */
  const semBuscaNova = candidatos === null;
  const podeSalvar = !!ponto && (semBuscaNova || exato || ajustado);

  useEffect(() => {
    onPodeSalvarChange(podeSalvar);
  }, [podeSalvar, onPodeSalvarChange]);

  useEffect(() => {
    buscarArea().then(setArea);
  }, []);

  async function procurarCep() {
    setBuscandoCep(true);
    try {
      const r = await buscarCep(cep);
      if (!r) {
        toast.warning('CEP não encontrado.', {
          description: 'Confira o número ou preencha o endereço à mão.',
        });
        return;
      }
      setPartes(r);
      onEnderecoChange(montar(r, numero));
      limparBusca();
      toast.success(`${r.logradouro}, ${r.bairro}`, {
        description: `${r.cidade} - ${r.uf}. Agora informe o número.`,
      });
    } finally {
      setBuscandoCep(false);
    }
  }

  function mudarNumero(n: string) {
    setNumero(n);
    if (partes) onEnderecoChange(montar(partes, n));
    limparBusca();
  }

  /** Qualquer mudança no texto invalida a coordenada achada para o texto anterior. */
  function limparBusca() {
    setCandidatos(null);
    setEscolhido(null);
    setAjustado(false);
    onPontoChange(null);
  }

  async function buscar() {
    const q = endereco.trim();
    if (q.length < 5) {
      toast.warning('Preencha o endereço antes de buscar.');
      return;
    }

    setBuscando(true);
    try {
      const r = await buscarEnderecos(q);
      setCandidatos(r);
      setAjustado(false);

      // Sempre seleciona o melhor candidato e MOSTRA O MAPA na hora.
      //
      // Antes, com vários candidatos, a tela exigia escolher um antes de mostrar o
      // mapa. Mas quando o número não é achado (o caso comum), os candidatos são
      // trechos da mesma rua — escolher entre eles é um chute sem gabarito. Eu
      // estava exigindo o palpite ANTES de entregar a ferramenta que resolve.
      // O pino é a resposta; a lista virou só um atalho pra recentralizar o mapa.
      if (r.length > 0) selecionar(r[0]);
    } catch {
      toast.error('Não foi possível buscar o endereço.');
    } finally {
      setBuscando(false);
    }
  }

  function selecionar(c: CandidatoEndereco) {
    setEscolhido(c);
    setAjustado(false);
    onPontoChange({ lat: c.lat, lng: c.lng });
  }

  function moverPino(p: Ponto) {
    onPontoChange(p);
    setAjustado(true);
  }

  const semResultado = candidatos !== null && candidatos.length === 0;

  return (
    <div className="space-y-3">
      {/* O CEP vem primeiro porque resolve a rua CERTA. Sem ele, "Rua Barão de
          Aracati" em Fortaleza casa com três ruas diferentes. */}
      <div className="space-y-2">
        <Label htmlFor="cep">
          CEP <span className="text-muted-foreground font-normal">(recomendado)</span>
        </Label>
        <div className="flex gap-2">
          <Input
            id="cep"
            inputMode="numeric"
            // NUNCA um CEP real aqui: em cinza ele parece campo preenchido, e um CEP
            // de Fortaleza num cliente de Caucaia faria o atendente puxar a rua
            // errada achando que já estava certo.
            placeholder="00000-000"
            maxLength={9}
            className="tabular"
            value={cep}
            onChange={(e) => setCep(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                procurarCep();
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={procurarCep}
            disabled={buscandoCep || cep.replace(/\D/g, '').length !== 8}
          >
            {buscandoCep ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
            <span className="hidden sm:inline">Buscar CEP</span>
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Preenche a rua certa sozinho — é o que evita cair em rua de mesmo nome em
          outro bairro.
        </p>
      </div>

      {partes && (
        <div className="space-y-2">
          <Label htmlFor="numero">Número da casa</Label>
          <Input
            id="numero"
            inputMode="numeric"
            placeholder="500"
            className="tabular"
            value={numero}
            onChange={(e) => mudarNumero(e.target.value)}
          />
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="endereco">Endereço completo</Label>
        <div className="flex gap-2">
          <Input
            id="endereco"
            placeholder="Rua, número, bairro, cidade"
            value={endereco}
            onChange={(e) => {
              onEnderecoChange(e.target.value);
              setPartes(null);
              limparBusca();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                buscar();
              }
            }}
          />
          <Button
            type="button"
            onClick={buscar}
            disabled={buscando || endereco.trim().length < 5}
          >
            {buscando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <MapPin className="size-4" />
            )}
            <span className="hidden sm:inline">No mapa</span>
          </Button>
        </div>
      </div>

      {/* Cerca desligada = "Av. Central" volta a casar com Gramado/RS, em silêncio.
          É o bug original do projeto. Grita alto: não é detalhe de config. */}
      {area && !area.cercaAtiva && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>Servidor sem área de entrega configurada</AlertTitle>
          <AlertDescription>
            O endereço pode ser localizado em outro estado sem aviso.{' '}
            <strong>Confira o pino no mapa antes de salvar</strong> e avise o
            responsável pelo sistema.
          </AlertDescription>
        </Alert>
      )}

      {/* Lista vazia = fora da cerca geográfica, NÃO "endereço inválido". Dizer
          "não encontrado" jogaria a culpa na digitação do atendente e o faria
          corrigir um erro que não existe. */}
      {semResultado && (
        <Alert variant="destructive">
          <TriangleAlert className="size-4" />
          <AlertTitle>Endereço fora da área de entrega</AlertTitle>
          <AlertDescription>
            {/* Vem do servidor: se o dono expandir a área, este texto muda sozinho.
                Chumbado, ele continuaria afirmando a área velha — com ar oficial. */}
            A entrega cobre <strong>{area?.cidades ?? 'a área de operação'}</strong>.
            Se o endereço é de lá mesmo, confira a escrita — ou marque o ponto
            clicando direto no mapa abaixo.
          </AlertDescription>
        </Alert>
      )}

      {/* MAPA PRIMEIRO. A resposta é o pino, não a lista. */}
      {(ponto || semResultado) && (
        <div className="space-y-2">
          {/* A instrução principal, antes do mapa — é o que a pessoa tem que fazer. */}
          {ponto && !podeSalvar && (
            <div className="bg-vip-soft text-vip-soft-foreground flex items-start gap-2.5 rounded-lg p-3">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 text-sm">
                <p className="font-semibold">
                  Arraste o pino até a casa do cliente
                </p>
                <p className="mt-0.5 text-xs opacity-90">
                  O mapa achou a rua, mas não o número
                  {numero ? ` ${numero}` : ''} — casa residencial quase nunca está
                  mapeada. O pino está em algum ponto da via. Use{' '}
                  <strong>Ver satélite</strong> para reconhecer a casa.
                </p>
              </div>
            </div>
          )}

          <Suspense fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
            <MapaPonto
              ponto={ponto}
              onMover={moverPino}
              className="h-72 w-full rounded-xl border"
            />
          </Suspense>

          {podeSalvar && (
            <div
              className={cn(
                'flex items-start gap-2 rounded-lg p-3 text-xs',
                ajustado || exato
                  ? 'bg-success-soft text-success-soft-foreground'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-medium">
                  {ajustado
                    ? 'Ponto marcado por você — é este que o entregador vai seguir'
                    : exato
                      ? 'Número exato encontrado no mapa'
                      : // Ponto que já estava salvo. Não afirmo que está certo —
                        // não sei. Digo o que é, e ofereço a correção.
                        'Localização já cadastrada. Se estiver errada, arraste o pino.'}
                </p>
                <p className="tabular mt-0.5 opacity-75">
                  {ponto!.lat.toFixed(6)}, {ponto!.lng.toFixed(6)}
                </p>
              </div>
            </div>
          )}

          {/* A lista é SECUNDÁRIA: só serve pra recentralizar o mapa em outro trecho
              da via. Com um candidato só, nem aparece — não há o que escolher. */}
          {candidatos && candidatos.length > 1 && (
            <details className="rounded-lg border px-3 py-2">
              <summary className="text-muted-foreground cursor-pointer text-xs">
                Rua errada? Escolher outro trecho ({candidatos.length})
              </summary>
              <div className="mt-2 space-y-1.5">
                {rotularLista(candidatos).map(({ candidato: c, rotulo }, i) => {
                  const ativo = escolhido === c;
                  return (
                    <button
                      key={`${c.lat},${c.lng},${i}`}
                      type="button"
                      onClick={() => selecionar(c)}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-left text-sm transition-colors',
                        ativo
                          ? 'border-brand bg-brand/5'
                          : 'hover:bg-accent/50',
                      )}
                    >
                      <span
                        className={cn(
                          'grid size-4 shrink-0 place-items-center rounded-full border',
                          ativo
                            ? 'border-brand bg-brand text-brand-foreground'
                            : 'border-input',
                        )}
                      >
                        {ativo && <Check className="size-2.5" />}
                      </span>
                      {/* Rótulo curto: sem CEP, sem "Região Nordeste", sem "Brasil".
                          Nada disso ajuda a decidir onde a casa está. */}
                      <span className="min-w-0 flex-1 truncate">{rotulo}</span>
                      {c.precisao === 'casa' && c.numero && (
                        <span className="bg-success-soft text-success-soft-foreground shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                          nº {c.numero}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      )}

      {!ponto && !semResultado && (
        <p className="text-muted-foreground text-xs">
          Sem localização, o pedido fica fora da rota otimizada e chega ao entregador
          no fim da lista.
        </p>
      )}
    </div>
  );
}

/**
 * Rotula a lista desambiguando colisões.
 *
 * O backend colapsa candidatos a menos de 150 m, mas dois trechos distantes da MESMA
 * avenida, no mesmo bairro, produzem o mesmo rótulo curto — e a tela mostraria duas
 * linhas idênticas. Escolher entre duas coisas iguais não é escolha, é ruído: foi
 * exatamente esse o problema que a lista longa causava.
 *
 * Quando o rótulo colide, numeramos os trechos. Não é um nome bonito, mas é honesto:
 * são de fato trechos diferentes da mesma via, e escolher só recentraliza o mapa.
 */
function rotularLista(candidatos: CandidatoEndereco[]) {
  const vezes = new Map<string, number>();
  for (const c of candidatos) {
    const r = rotularCandidato(c);
    vezes.set(r, (vezes.get(r) ?? 0) + 1);
  }

  const usados = new Map<string, number>();
  return candidatos.map((candidato) => {
    const base = rotularCandidato(candidato);
    if ((vezes.get(base) ?? 0) < 2) return { candidato, rotulo: base };

    const n = (usados.get(base) ?? 0) + 1;
    usados.set(base, n);
    return { candidato, rotulo: `${base} · trecho ${n}` };
  });
}

function montar(
  p: { logradouro: string; bairro: string; cidade: string; uf: string },
  numero: string,
) {
  const rua = numero.trim() ? `${p.logradouro}, ${numero.trim()}` : p.logradouro;
  return `${rua} - ${p.bairro}, ${p.cidade} - ${p.uf}`;
}
