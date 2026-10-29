// Driver KYC state machine. Server enforcement lives in
// apps/api/src/drivers/kyc-state-machine.ts with the identical list;
// Phase 16 unifies them into one compiled shared package.
import type { KycStatus } from './index';

export const KYC_TRANSITIONS: Record<KycStatus, KycStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'REJECTED'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'SUSPENDED'],
  APPROVED: ['SUSPENDED', 'EXPIRED'],
  REJECTED: ['SUBMITTED'],
  SUSPENDED: ['APPROVED', 'REJECTED'],
  EXPIRED: ['SUBMITTED'],
};

export function canTransitionKyc(from: KycStatus, to: KycStatus): boolean {
  return KYC_TRANSITIONS[from].includes(to);
}
