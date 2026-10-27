import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const MOTIVOS_NAO_ENTREGA = [
  'cliente_ausente',
  'endereco_nao_encontrado',
  'cliente_recusou',
  'outro',
] as const;

export type MotivoNaoEntrega = (typeof MOTIVOS_NAO_ENTREGA)[number];

export class NaoEntregueDto {
  @IsIn(MOTIVOS_NAO_ENTREGA)
  motivo: MotivoNaoEntrega;

  /** Texto livre do entregador. Vai para a auditoria junto com o motivo. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  observacao?: string;
}
