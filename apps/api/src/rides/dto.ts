import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class DeliveryDetailsDto {
  @IsString() @MinLength(1) senderName!: string;
  @IsString() @MinLength(1) senderPhone!: string;
  @IsString() @MinLength(1) recipientName!: string;
  @IsString() @MinLength(1) recipientPhone!: string;
  @IsString() @MinLength(1) packageCategory!: string; // Validated against the admin-managed list in RidesService.
  @IsOptional() @IsString() sizeWeight?: string;
  @IsOptional() @IsString() notes?: string;
}

export class GeoPointDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class EstimateDto {
  @ValidateNested() @Type(() => GeoPointDto) pickup!: GeoPointDto;
  @ValidateNested() @Type(() => GeoPointDto) destination!: GeoPointDto;
  @IsIn(['CAR', 'BIKE', 'DELIVERY']) service!: string;
  @IsOptional() @IsIn(['BIKE', 'CAR_ECONOMY', 'CAR_STANDARD', 'CAR_PREMIUM']) category?: string;
}

export class RequestRideDto extends EstimateDto {
  @IsOptional() @IsString() pickupLabel?: string;
  @IsOptional() @IsString() destinationLabel?: string;
  @IsOptional() @IsInt() @Min(0) customerOfferMinor?: number;
  @IsIn(['CASH', 'WALLET']) paymentMethod!: string;
  @IsOptional() @ValidateNested() @Type(() => DeliveryDetailsDto) deliveryDetails?: DeliveryDetailsDto;
}

export class CancelRideDto {
  @IsOptional() @IsString() reason?: string;
}
