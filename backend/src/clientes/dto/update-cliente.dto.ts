import {
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class UpdateClienteDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  nome?: string;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  telefone?: string;

  @IsOptional()
  @IsString()
  @Length(3, 255)
  endereco?: string;

  /**
   * Se vierem, mandam. Se o endereço mudar e estes NÃO vierem, o backend
   * regeocodifica — assim corrigir o endereço conserta o ponto no mapa junto.
   */
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  referencia?: string;
}
