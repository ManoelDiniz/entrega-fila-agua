import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Vazio "saudável" (fila zerada é boa notícia) — por isso o tom é neutro e
 * calmo, não um alerta.
 */
export function EmptyState({
  icone: Icone,
  titulo,
  descricao,
  acao,
  className,
}: {
  icone: LucideIcon;
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-12 text-center',
        className,
      )}
    >
      <span className="bg-muted text-muted-foreground grid size-11 place-items-center rounded-xl">
        <Icone className="size-5" />
      </span>
      <p className="mt-4 text-sm font-medium">{titulo}</p>
      {descricao && (
        <p className="text-muted-foreground mt-1 max-w-xs text-sm">{descricao}</p>
      )}
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}
