import { useState, type FormEvent } from 'react';
import { Droplets, Eye, EyeOff, Loader2, LogIn, Route, Zap } from 'lucide-react';
import { useAuth } from '@/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const DESTAQUES = [
  { icone: Zap, texto: 'Fila por prioridade — urgente e VIP na frente.' },
  { icone: Route, texto: 'Lotes com rota otimizada para o entregador.' },
  { icone: Droplets, texto: 'Painel ao vivo: cada pedido aparece na hora.' },
];

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      await login(email.trim(), senha);
    } catch {
      setErro('E-mail ou senha inválidos.');
      setSenha('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      {/* Painel de marca — some no celular, onde só o formulário importa. */}
      <aside className="bg-shell text-shell-foreground relative hidden overflow-hidden p-12 lg:flex lg:flex-col">
        <div
          aria-hidden
          className="bg-aqua/20 absolute -top-24 -left-24 size-96 rounded-full blur-3xl"
        />
        <div
          aria-hidden
          className="bg-brand/25 absolute -right-32 -bottom-32 size-[28rem] rounded-full blur-3xl"
        />

        <div className="relative flex items-center gap-2.5">
          <span className="bg-aqua/15 text-aqua grid size-10 place-items-center rounded-xl">
            <Droplets className="size-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Fila<span className="text-aqua">Água</span>
          </span>
        </div>

        <div className="relative mt-auto">
          <h2 className="max-w-md text-4xl leading-[1.15] font-semibold tracking-tight text-balance">
            A fila certa, na ordem certa, no caminho certo.
          </h2>
          <ul className="mt-8 space-y-3.5">
            {DESTAQUES.map(({ icone: Icone, texto }) => (
              <li key={texto} className="flex items-center gap-3 text-sm">
                <span className="bg-shell-border/70 text-aqua grid size-7 shrink-0 place-items-center rounded-lg">
                  <Icone className="size-3.5" />
                </span>
                <span className="text-shell-foreground/85">{texto}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-shell-muted relative mt-12 text-xs">
          Controle de entrega por fila · Entregadora de água
        </p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          {/* No celular a marca vive aqui em cima. */}
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="bg-brand/10 text-brand grid size-10 place-items-center rounded-xl">
              <Droplets className="size-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">
              Fila<span className="text-brand">Água</span>
            </span>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Use as credenciais da sua conta para continuar.
          </p>

          <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoFocus
                placeholder="voce@entrega-agua.local"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!erro}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="senha">Senha</Label>
              <div className="relative">
                <Input
                  id="senha"
                  type={verSenha ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pr-10"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  aria-invalid={!!erro}
                  required
                />
                <button
                  type="button"
                  onClick={() => setVerSenha((v) => !v)}
                  aria-label={verSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 grid w-10 place-items-center rounded-r-md transition-colors"
                >
                  {verSenha ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {erro && (
              <Alert variant="destructive">
                <AlertDescription>{erro}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={enviando || !email || !senha}
            >
              {enviando ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Entrando…
                </>
              ) : (
                <>
                  <LogIn className="size-4" />
                  Entrar
                </>
              )}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
