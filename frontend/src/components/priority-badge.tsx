import { cva, type VariantProps } from 'class-variance-authority';
import { AlertTriangle, Crown, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';

const badge = cva(
  'inline-flex items-center gap-1 rounded-full border font-medium tracking-wide uppercase whitespace-nowrap',
  {
    variants: {
      prioridade: {
        urgente: 'bg-urgente-soft text-urgente-soft-foreground border-urgente/25',
        vip: 'bg-vip-soft text-vip-soft-foreground border-vip/25',
        normal: 'bg-normal-soft text-normal-soft-foreground border-normal/20',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-[10px]',
        md: 'px-2 py-0.5 text-[11px]',
      },
    },
    defaultVariants: { prioridade: 'normal', size: 'md' },
  },
);

const ICONES = {
  urgente: AlertTriangle,
  vip: Crown,
  normal: Circle,
} as const;

export type Prioridade = keyof typeof ICONES;

/** Normaliza o que vem da API — só os três níveis conhecidos são estilizados. */
export function normalizarPrioridade(valor: string): Prioridade {
  return valor === 'urgente' || valor === 'vip' ? valor : 'normal';
}

export function PriorityBadge({
  prioridade,
  size,
  className,
}: { prioridade: string; className?: string } & Pick<
  VariantProps<typeof badge>,
  'size'
>) {
  const p = normalizarPrioridade(prioridade);
  const Icone = ICONES[p];

  return (
    <span className={cn(badge({ prioridade: p, size }), className)}>
      <Icone className={cn('shrink-0', size === 'sm' ? 'size-2.5' : 'size-3')} />
      {p}
    </span>
  );
}
