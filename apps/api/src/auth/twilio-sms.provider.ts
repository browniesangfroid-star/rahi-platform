import type { SmsProvider } from './sms.provider';

export interface TwilioSmsConfig {
  accountSid: string;
  authToken: string;
  /** Twilio phone number (E.164) or alphanumeric sender ID (max 11 chars). */
  from: string;
  /** Brand shown in the message body. Defaults to 'Rahi'. */
  brand?: string;
}

type FetchFn = (url: string, init: Record<string, unknown>) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/**
 * Real SMS delivery via Twilio's Messages API, using plain fetch so
 * no Twilio SDK dependency is needed. The fetch function is
 * injectable for unit tests.
 *
 * Failure semantics: a non-2xx response throws with Twilio's error
 * code/message (never the OTP code, never the full phone number —
 * the number is masked in the message). AuthService treats that as
 * a failed OTP request, so the API never claims a code was sent
 * when Twilio rejected it. The stored code stays valid for its
 * 5-minute window; a retry generates a fresh code.
 */
export class TwilioSmsProvider implements SmsProvider {
  private readonly brand: string;

  constructor(
    private readonly config: TwilioSmsConfig,
    private readonly fetchFn: FetchFn = fetch as unknown as FetchFn,
  ) {
    this.brand = config.brand ?? 'Rahi';
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    const body = `Your ${this.brand} code is ${code}. It expires in 5 minutes.`;
    const params = new URLSearchParams({ To: phone, From: this.config.from, Body: body });
    const credentials = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await this.fetchFn(
        `https://api.twilio.com/2010-04-01/Accounts/${this.config.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      let detail = `Twilio HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(await response.text()) as { code?: number; message?: string };
        if (parsed.code || parsed.message) detail = `Twilio ${parsed.code ?? ''} ${parsed.message ?? ''}`.trim();
      } catch {
        // Keep the HTTP status; the body was not JSON.
      }
      const masked = phone.length > 3 ? `${phone.slice(0, 3)}***${phone.slice(-2)}` : '***';
      throw new Error(`SMS delivery failed for ${masked}: ${detail}`);
    }
  }
}
