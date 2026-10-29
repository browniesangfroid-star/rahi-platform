import { IsIn, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class TopupDto {
  @IsIn(['CUSTOMER', 'DRIVER']) ownerType!: string;
  @IsInt() @Min(1) amountMinor!: number;
  @IsOptional() @IsString() reference?: string;
}

export class WithdrawalDto {
  @IsIn(['CUSTOMER', 'DRIVER']) ownerType!: string;
  @IsInt() @Min(1) amountMinor!: number;
}

export class ApproveWithdrawalDto {
  @IsOptional() @IsString() payoutReference?: string;
}

export class CommissionRuleDto {
  @IsIn(['GLOBAL', 'CITY', 'SERVICE_CITY', 'DRIVER']) scope!: string;
  @IsOptional() @IsString() cityId?: string;
  @IsOptional() @IsString() serviceCode?: string;
  @IsOptional() @IsString() driverUserId?: string;
  @IsInt() @Min(0) ratePercent!: number;
}

export class RefundDto {
  @IsInt() @Min(1) amountMinor!: number;
  @IsString() @MinLength(3) reason!: string;
}

export class CancellationFeeDto {
  @IsInt() @Min(0) amountMinor!: number;
}
