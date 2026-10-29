import { IsInt, IsOptional, Min } from 'class-validator';

export class CreateOfferDto {
  @IsOptional() @IsInt() @Min(0) fareMinor?: number;
}

export class CounterOfferDto {
  @IsInt() @Min(0) fareMinor!: number;
}
