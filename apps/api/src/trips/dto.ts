import { IsOptional, IsString, MinLength } from 'class-validator';

export class CancelTripDto {
  @IsOptional() @IsString() reason?: string;
}

export class VerifyPinDto {
  @IsString() @MinLength(4) pin!: string;
}

export class VerifyOtpDto {
  @IsString() @MinLength(4) otp!: string;
}
