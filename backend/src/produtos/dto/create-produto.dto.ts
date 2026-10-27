import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateProdutoDto {
  @IsString()
  @MaxLength(120)
  nome: string;

  /** Entra como number; volta como string no JSON (DECIMAL do MySQL). */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  preco: number;

  /**
   * TINYINT no banco: **0 ou 1, não boolean** — e é assim que ele volta no JSON.
   * Default 1 (ativo).
   */
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1])
  ativo?: number;
}
