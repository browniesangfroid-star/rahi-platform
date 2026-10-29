import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class LocationDto {
  @IsNumber() @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Min(-180) @Max(180) lng!: number;
}

export class GoOnlineDto {
  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
}

export class RegisterDriverDto {
  @IsOptional() @IsString() emergencyContactName?: string;
  @IsOptional() @IsString() emergencyContactPhone?: string;
  @IsOptional() @IsString() bankAccount?: string;
}

export class ReasonDto {
  @IsString() @MinLength(3) reason!: string;
}

export class CreateVehicleDto {
  @IsIn(['BIKE', 'CAR_ECONOMY', 'CAR_STANDARD', 'CAR_PREMIUM']) categoryCode!: string;
  @IsString() @MinLength(1) make!: string;
  @IsString() @MinLength(1) model!: string;
  @IsInt() @Min(1990) @Max(2030) year!: number;
  @IsString() @MinLength(1) color!: string;
  @IsString() @MinLength(2) registrationNumber!: string;
}

export class DocumentMetaDto {
  @IsIn(['CNIC', 'LICENCE', 'VEHICLE_REGISTRATION', 'VEHICLE_PHOTO', 'PROFILE_PHOTO']) documentType!: string;
  @IsOptional() @IsString() expiresAt?: string;
}
