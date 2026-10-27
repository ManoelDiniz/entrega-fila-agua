import { IsLatitude, IsLongitude, IsOptional } from 'class-validator';

export class ReotimizarDto {
  /**
   * Posição atual do entregador (novo ponto de partida da rota).
   * Se não vier, a reotimização usa o ponto de partida original do lote.
   */
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;
}
