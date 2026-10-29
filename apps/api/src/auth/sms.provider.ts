export const SMS_PROVIDER = 'SMS_PROVIDER';

export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}

/**
 * Default provider: logs that an OTP was requested WITHOUT logging the code,
 * and does not claim delivery. Real delivery needs the SMS vendor decision
 * (still open, see DECISIONS.md) — wiring a vendor is one provider class.
 * Tests inject their own capturing provider; production must not use this.
 */
export class LogSmsProvider implements SmsProvider {
  async sendOtp(phone: string): Promise<void> {
    const masked = phone.length > 3 ? `${phone.slice(0, 3)}***${phone.slice(-2)}` : '***';
    // eslint-disable-next-line no-console
    console.log(`[sms] OTP requested for ${masked} — no SMS vendor configured, code NOT logged`);
  }
}
