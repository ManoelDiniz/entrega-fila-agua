import { IsInt, IsNumber, Max, Min } from 'class-validator';

export class CriarLoteDto {
  /** Quantas entregas o entregador quer puxar da fila. */
  @IsInt()
  @Min(1)
  @Max(50)
  qtd: number;

  /** GPS atual do entregador (ponto de partida da rota). */
  @IsNumber()
  lat: number;

  @IsNumber()
  lng: number;
}
