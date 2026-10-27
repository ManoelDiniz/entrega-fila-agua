import { IsLatitude, IsLongitude } from 'class-validator';

export class CoordenadasDto {
  @IsLatitude()
  lat: number;

  @IsLongitude()
  lng: number;
}
