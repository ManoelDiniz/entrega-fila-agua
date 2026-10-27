import type { LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const acento = cva('', {
  variants: {
    tone: {
      urgente: '[--tone:var(--urgente)] [--tone-soft:var(--urgente-soft)]',
      vip: '[--tone:var(--vip)] [--tone-soft:var(--vip-soft)]',
      normal: '[--tone:var(--normal)] [--tone-soft:var(--normal-soft)]',
      brand: '[--tone:var(--brand)] [--tone-soft:var(--brand-muted)]',
    },
  },
  defaultVariants: { tone: 'brand' },
});

interface StatCardProps extends VariantProps<typeof acento> {
  rotulo: string;
  valor: number;
  icone: LucideIcon;
  /** Mostra um ponto pulsante — o número está chegando por socket. */
  aoVivo?: boolean;
  carregando?: boolean;
  className?: string;
}

export function StatCard({
  rotulo,
  valor,
  icone: Icone,
  tone,
  aoVivo,
  carregando,
  className,
}: StatCardProps) {
  return (
    <Card
      className={cn(
        acento({ tone }),
        'relative gap-0 overflow-hidden p-4 sm:p-5',
        'transition-colors hover:border-[var(--tone)]/40',
        className,
      )}
    >
      {/* Faixa de acento: identifica o nível sem depender só da cor do número. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 bg-[var(--tone)]"
      />

      <div className="flex items-start justify-between gap-2">
        <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {rotulo}
        </span>
        <span className="grid size-7 place-items-center rounded-md bg-[var(--tone-soft)]">
          <Icone className="size-3.5 text-[var(--tone)]" />
        </span>
      </div>

      {carregando ? (
        <Skeleton className="mt-3 h-9 w-14" />
      ) : (
        <div className="tabular mt-2 text-4xl leading-none font-semibold tracking-tight">
          {valor}
        </div>
      )}

      {aoVivo && (
        <div className="text-muted-foreground mt-3 flex items-center gap-1.5 text-[11px]">
          <span className="relative flex size-1.5">
            <span className="bg-success absolute inline-flex size-full animate-pulse-ring rounded-full" />
            <span className="bg-success relative inline-flex size-1.5 rounded-full" />
          </span>
          ao vivo
        </div>
      )}
    </Card>
  );
}
