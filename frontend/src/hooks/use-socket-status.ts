import { useEffect, useState } from 'react';
import { getSocket } from '@/socket';

/**
 * Estado da conexão em tempo real. Usado no header para o operador saber, sem
 * adivinhar, se os números na tela ainda estão vivos.
 */
export function useSocketStatus() {
  const [conectado, setConectado] = useState(() => getSocket().connected);

  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => setConectado(true);
    const onDisconnect = () => setConectado(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    setConectado(socket.connected);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return conectado;
}
