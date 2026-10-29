import test from 'node:test';
import assert from 'node:assert/strict';
import { TwilioSmsProvider } from '../../dist/auth/twilio-sms.provider.js';

function provider(capture, status = 201, body = '{"sid":"SM123"}') {
  const fetchFn = async (url, init) => {
    capture.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return new TwilioSmsProvider(
    { accountSid: 'ACtest', authToken: 'secret-token', from: '+15005550006' },
    fetchFn,
  );
}

test('twilio sms: posts to the Messages API with Basic auth and the code', async () => {
  const capture = [];
  await provider(capture).sendOtp('+923001234567', '482916');
  assert.equal(capture.length, 1);
  const { url, init } = capture[0];
  assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Basic ${Buffer.from('ACtest:secret-token').toString('base64')}`);
  const params = new URLSearchParams(init.body);
  assert.equal(params.get('To'), '+923001234567');
  assert.equal(params.get('From'), '+15005550006');
  assert.ok(params.get('Body').includes('482916'));
  assert.ok(params.get('Body').includes('Rahi'));
});

test('twilio sms: non-2xx throws with Twilio code, masked phone, no OTP code', async () => {
  const capture = [];
  const failing = provider(capture, 400, '{"code":21211,"message":"Invalid To number"}');
  await assert.rejects(() => failing.sendOtp('+923001234567', '482916'), (e) => {
    assert.match(e.message, /21211/);
    assert.match(e.message, /\+92\*\*\*67/);
    assert.doesNotMatch(e.message, /482916/);
    return true;
  });
});

test('twilio sms: brand override is used in the message body', async () => {
  const capture = [];
  const fetchFn = async (url, init) => {
    capture.push(init);
    return { ok: true, status: 201, text: async () => '{}' };
  };
  const branded = new TwilioSmsProvider(
    { accountSid: 'ACtest', authToken: 'secret-token', from: 'RAHI', brand: 'Rahi' },
    fetchFn,
  );
  await branded.sendOtp('+923001234567', '123456');
  const params = new URLSearchParams(capture[0].body);
  assert.equal(params.get('From'), 'RAHI');
  assert.ok(params.get('Body').startsWith('Your Rahi code is 123456'));
});
