import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateCityDto {
  @IsString() @MinLength(1) name!: string;
  @IsString() @MinLength(2) countryCode!: string;
  @IsString() @MinLength(3) currency!: string;
  @IsString() @MinLength(1) timezone!: string;
  @IsNumber() @Min(-90) @Max(90) centreLat!: number;
  @IsNumber() @Min(-180) @Max(180) centreLng!: number;
}

export class SetCityActiveDto {
  @IsBoolean() isActive!: boolean;
}

export class CreatePricingRuleDto {
  @IsOptional() @IsString() cityId?: string;
  @IsString() serviceCode!: string;
  @IsIn(['NEGOTIATION', 'FIXED', 'DYNAMIC', 'HYBRID']) mode!: string;
  @IsInt() @Min(0) baseFareMinor!: number;
  @IsInt() @Min(0) perKmMinor!: number;
  @IsInt() @Min(0) perMinMinor!: number;
  @IsInt() @Min(0) minimumFareMinor!: number;
  @IsInt() @Min(0) bookingFeeMinor!: number;
  @IsNumber() @Min(1) @Max(5) demandCap!: number;
}

export class UpdateCatalogDto {
  @IsString() @MinLength(1) name!: string;
  @IsBoolean() isActive!: boolean;
}

export class SetServiceCategoriesDto {
  @IsObject() mapping!: Record<string, string[]>;
}

export class SetPackageCategoriesDto {
  @IsArray() @IsString({ each: true }) categories!: string[];
}
