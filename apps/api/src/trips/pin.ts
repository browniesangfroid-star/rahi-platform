import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';

export const PIN_LENGTH = 4;

/** Generates a 4-digit PIN and its bcrypt hash. The plaintext is
 *  returned to the customer exactly once (at accept, or on regenerate)
 *  and never stored — only the hash lives in ride_pins. */
export function generatePin(): { pin: string; hash: string } {
  const pin = String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, '0');
  return { pin, hash: bcrypt.hashSync(pin, 10) };
}
