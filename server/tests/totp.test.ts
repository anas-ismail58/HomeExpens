import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decryptSecret, encryptSecret, totpCode } from '../src/services/totp.service';

test('TOTP matches the RFC 6238 SHA-1 test vectors', () => {
  // Secret "12345678901234567890" in base32; RFC times 59, 1111111109, 1234567890 (last 6 digits).
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totpCode(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totpCode(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totpCode(secret, Math.floor(1234567890 / 30)), '005924');
});

test('2FA secrets are encrypted at rest and round-trip', () => {
  const stored = encryptSecret('JBSWY3DPEHPK3PXP');
  assert.ok(!stored.includes('JBSWY3DPEHPK3PXP'));
  assert.equal(decryptSecret(stored), 'JBSWY3DPEHPK3PXP');
});
