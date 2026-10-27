import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** PATCH parcial: tudo opcional. */
export class UpdateProdutoDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nome?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  preco?: number;

  /**
   * 0 desativa (some das telas de venda), 1 reativa. Nunca apaga.
   * TINYINT: 0|1, não boolean.
   */
  @IsOptional()
  @Type(() => Number)
  @IsIn([0, 1])
  ativo?: number;
}
