import { Navigate, Route, Routes } from 'react-router-dom';
import { Droplets } from 'lucide-react';
import { useAuth } from '@/auth';
import { Login } from '@/pages/Login';
import { AdminPanel } from '@/pages/AdminPanel';
import { Atendente } from '@/pages/Atendente';
import { Clientes } from '@/pages/Clientes';
import { Entregador } from '@/pages/Entregador';
import { Produtos } from '@/pages/Produtos';

/** Splash enquanto a sessão é restaurada a partir do token. */
function Carregando() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="flex flex-col items-center gap-4">
        <span className="bg-brand/10 text-brand grid size-12 animate-pulse place-items-center rounded-2xl">
          <Droplets className="size-6" />
        </span>
        <p className="text-muted-foreground text-sm">Carregando…</p>
      </div>
    </div>
  );
}

const INICIO_POR_PERFIL = {
  admin: AdminPanel,
  atendente: Atendente,
  entregador: Entregador,
} as const;

export function App() {
  const { usuario, carregando } = useAuth();

  if (carregando) return <Carregando />;

  if (!usuario) {
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  const Inicio = INICIO_POR_PERFIL[usuario.perfil];
  if (!Inicio) return <PerfilDesconhecido />;

  // Clientes e Produtos são de atendente e admin. O backend também barra o
  // entregador em /api/clientes (RolesGuard), então aqui é só não oferecer a rota
  // que ele não pode usar.
  const podeGerenciar = usuario.perfil === 'atendente' || usuario.perfil === 'admin';

  return (
    <Routes>
      <Route path="/" element={<Inicio />} />
      {podeGerenciar && (
        <>
          <Route path="/clientes" element={<Clientes />} />
          <Route path="/produtos" element={<Produtos />} />
        </>
      )}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function PerfilDesconhecido() {
  const { usuario, logout } = useAuth();
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="text-sm font-medium">
          Perfil sem painel: <code>{usuario?.perfil}</code>
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          Fale com o administrador.{' '}
          <button onClick={logout} className="text-brand underline underline-offset-4">
            Sair
          </button>
        </p>
      </div>
    </div>
  );
}
