import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import {
  Droplets,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Package,
  Receipt,
  Sun,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Perfil } from '@/auth';
import { useAuth } from '@/auth';
import { useTheme } from '@/components/theme-provider';
import { useSocketStatus } from '@/hooks/use-socket-status';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const ROTULO_PERFIL: Record<string, string> = {
  admin: 'Administrador',
  atendente: 'Atendente',
  entregador: 'Entregador',
};

interface ItemNav {
  para: string;
  rotulo: string;
  icone: LucideIcon;
}

/**
 * Navegação por perfil. O entregador fica de fora de propósito: ele trabalha numa
 * tela só, na rua, e um menu ali é só coisa pra errar com a mão ocupada.
 */
const NAV_POR_PERFIL: Record<Perfil, ItemNav[]> = {
  admin: [
    { para: '/', rotulo: 'Painel', icone: LayoutDashboard },
    { para: '/clientes', rotulo: 'Clientes', icone: Users },
    { para: '/produtos', rotulo: 'Produtos', icone: Package },
  ],
  atendente: [
    { para: '/', rotulo: 'Pedido', icone: Receipt },
    { para: '/clientes', rotulo: 'Clientes', icone: Users },
    { para: '/produtos', rotulo: 'Produtos', icone: Package },
  ],
  entregador: [],
};

function Navegacao({ itens }: { itens: ItemNav[] }) {
  if (itens.length === 0) return null;

  return (
    <nav className="ml-1 flex items-center gap-1 border-l border-(--shell-border) pl-2">
      {itens.map(({ para, rotulo, icone: Icone }) => (
        <NavLink
          key={para}
          to={para}
          // `end` só na raiz: sem isso "/" casaria com /clientes e /produtos
          // também, e as três abas ficariam acesas ao mesmo tempo.
          end={para === '/'}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-shell-border/80 text-shell-foreground'
                : 'text-shell-muted hover:bg-shell-border/40 hover:text-shell-foreground',
            )
          }
        >
          <Icone className="size-4" />
          <span className="hidden sm:inline">{rotulo}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Ponto de conexão do socket: verde vivo, âmbar reconectando. */
function StatusConexao() {
  const conectado = useSocketStatus();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
            conectado
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-vip/30 bg-vip/10 text-vip',
          )}
        >
          {conectado ? (
            <>
              <span className="relative flex size-1.5">
                <span className="bg-success absolute inline-flex size-full animate-pulse-ring rounded-full" />
                <span className="bg-success relative inline-flex size-1.5 rounded-full" />
              </span>
              <Wifi className="size-3" />
            </>
          ) : (
            <WifiOff className="size-3" />
          )}
          <span className="hidden sm:inline">
            {conectado ? 'ao vivo' : 'reconectando'}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {conectado
          ? 'Conectado — a tela atualiza sozinha.'
          : 'Sem tempo real. Os dados podem estar defasados.'}
      </TooltipContent>
    </Tooltip>
  );
}

function AlternarTema() {
  const { theme, setTheme } = useTheme();
  const opcoes = [
    { valor: 'light', rotulo: 'Claro', icone: Sun },
    { valor: 'dark', rotulo: 'Escuro', icone: Moon },
    { valor: 'system', rotulo: 'Sistema', icone: Monitor },
  ] as const;

  return (
    <>
      <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
        Tema
      </DropdownMenuLabel>
      {opcoes.map(({ valor, rotulo, icone: Icone }) => (
        <DropdownMenuItem
          key={valor}
          onClick={() => setTheme(valor)}
          className={cn(theme === valor && 'bg-accent')}
        >
          <Icone className="size-4" />
          {rotulo}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function AppShell({
  titulo,
  descricao,
  acoes,
  children,
}: {
  titulo: string;
  descricao?: string;
  /** Ações contextuais da página, no topo do conteúdo. */
  acoes?: ReactNode;
  children: ReactNode;
}) {
  const { usuario, logout } = useAuth();
  const iniciais = (usuario?.nome ?? '?')
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="bg-shell text-shell-foreground border-shell-border sticky top-0 z-40 border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4">
          <div className="flex items-center gap-2">
            <span className="bg-aqua/15 text-aqua grid size-8 place-items-center rounded-lg">
              <Droplets className="size-4.5" />
            </span>
            <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">
              Fila<span className="text-aqua">Água</span>
            </span>
          </div>

          <Navegacao itens={NAV_POR_PERFIL[usuario?.perfil ?? 'entregador'] ?? []} />

          <div className="ml-auto flex items-center gap-2">
            <StatusConexao />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="hover:bg-shell-border/60 hover:text-shell-foreground h-9 gap-2 px-1.5 sm:pr-3"
                >
                  <span className="bg-aqua/20 text-aqua grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold">
                    {iniciais}
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block text-xs leading-tight font-medium">
                      {usuario?.nome}
                    </span>
                    <span className="text-shell-muted block text-[10px] leading-tight">
                      {ROTULO_PERFIL[usuario?.perfil ?? ''] ?? usuario?.perfil}
                    </span>
                  </span>
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="flex flex-col gap-0.5">
                  <span className="text-sm">{usuario?.nome}</span>
                  <span className="text-muted-foreground text-xs font-normal">
                    {usuario?.email}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <AlternarTema />
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Sair fica VISÍVEL no header, não escondido no menu: é uma ação que
                o entregador pode precisar na rua, com o celular na mão. */}
            <Button
              variant="ghost"
              onClick={logout}
              aria-label="Sair"
              title="Sair"
              className="hover:bg-shell-border/60 hover:text-shell-foreground h-9 gap-2 px-2 sm:px-3"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
              {titulo}
            </h1>
            {descricao && (
              <p className="text-muted-foreground mt-1 text-sm">{descricao}</p>
            )}
          </div>
          {acoes}
        </div>

        {children}
      </main>
    </div>
  );
}
