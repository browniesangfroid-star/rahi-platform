import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class RateRideDto {
  @IsInt() @Min(1) @Max(5) stars!: number;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() reportReason?: string;
}

export class CreateTicketDto {
  @IsOptional() @IsString() rideId?: string;
  @IsIn(['RIDE_ISSUE', 'PAYMENT', 'SAFETY', 'ACCOUNT', 'OTHER']) category!: string;
  @IsString() @MinLength(3) subject!: string;
  @IsString() @MinLength(1) message!: string;
}

export class ReplyTicketDto {
  @IsString() @MinLength(1) message!: string;
}

export class SetTicketStatusDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) status!: string;
}

export class SosDto {
  @IsOptional() @IsString() note?: string;
}

export class ResolveIncidentDto {
  @IsString() @MinLength(3) resolutionNote!: string;
}

export class ShareLinkDto {
  @IsOptional() @IsInt() @Min(5) @Max(1440) ttlMinutes?: number;
}

export class SuspendUserDto {
  @IsString() @MinLength(3) reason!: string;
}
