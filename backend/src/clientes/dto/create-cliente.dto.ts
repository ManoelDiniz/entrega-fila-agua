import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateClienteDto {
  @IsString()
  nome: string;

  @IsOptional()
  @IsString()
  telefone?: string;

  @IsString()
  endereco: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsString()
  referencia?: string;
}
