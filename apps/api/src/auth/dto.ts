import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches, MinLength } from 'class-validator';

const E164 = /^\+[1-9]\d{7,14}$/;

export class RequestOtpDto {
  @IsString() @Matches(E164, { message: 'phone must be E.164, e.g. +923001234567' })
  phone!: string;
}
export class VerifyOtpDto {
  @IsString() @Matches(E164) phone!: string;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
export class RefreshDto {
  @IsString() @IsNotEmpty() refreshToken!: string;
}
export class AdminLoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) password!: string;
}
export class MfaVerifyDto {
  @IsString() @IsNotEmpty() mfaToken!: string;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
export class MfaEnableDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
}
export class UpdateProfileDto {
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
}
export class CreateRoleDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() permissionNames?: string[];
}
export class AssignRoleDto {
  @IsString() @IsNotEmpty() roleName!: string;
}
