import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { toast } from 'sonner';
import { api } from './api';
import { desconectarSocket, getSocket } from './socket';

export type Perfil = 'admin' | 'atendente' | 'entregador';

export interface Usuario {
  id: string;
  nome: string;
  email: string;
  perfil: Perfil;
}

interface AuthContextType {
  usuario: Usuario | null;
  carregando: boolean;
  login: (email: string, senha: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  // Restaura a sessão a partir do token salvo.
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setCarregando(false);
      return;
    }
    api
      .get<Usuario>('/auth/me')
      .then((r) => setUsuario(r.data))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setCarregando(false));
  }, []);

  // O JWT dura 8h e pode vencer com o painel aberto. Quando isso acontece o
  // servidor recusa o handshake do socket e o cliente entra em retry infinito —
  // a tela congela com os últimos números, ainda rotulados "ao vivo". Números
  // velhos disfarçados de atuais são piores que um erro: o admin toma decisão em
  // cima deles. Então derrubamos a sessão e mandamos pro login.
  useEffect(() => {
    if (!usuario) return;

    const socket = getSocket();
    const onErro = (e: Error) => {
      // Só erro de credencial. Queda de rede também emite connect_error, e aí
      // reconectar é o certo — não deslogar quem só passou por um túnel.
      if (e.message !== 'token_ausente' && e.message !== 'token_invalido') return;

      toast.error('Sua sessão expirou.', { description: 'Entre novamente.' });
      logout();
    };

    socket.on('connect_error', onErro);
    return () => {
      socket.off('connect_error', onErro);
    };
  }, [usuario]);

  async function login(email: string, senha: string) {
    const r = await api.post<{ token: string; usuario: Usuario }>(
      '/auth/login',
      { email, senha },
    );
    localStorage.setItem('token', r.data.token);
    setUsuario(r.data.usuario);
  }

  function logout() {
    localStorage.removeItem('token');
    setUsuario(null);
    // O socket precisa cair junto: senão a conexão de tempo real do usuário que
    // saiu continua viva e é herdada por quem entrar depois.
    desconectarSocket();
  }

  return (
    <AuthContext.Provider value={{ usuario, carregando, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve estar dentro de AuthProvider');
  return ctx;
}
