import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeNumber, numbersMatch } from '../src/services/receipt.service';

test('Receiver numbers: country codes, Arabic digits and hidden digits', () => {
  assert.equal(normalizeNumber('+20 101 234 5678'), '01012345678');
  assert.equal(normalizeNumber('٠١٠١٢٣٤٥٦٧٨'), '01012345678');
  assert.equal(normalizeNumber('00966 50 123 4567'), '0501234567');
  assert.equal(normalizeNumber('010****5678'), '010****5678');

  assert.equal(numbersMatch('01012345678', '+201012345678'), true);
  assert.equal(numbersMatch('010****5678', '01012345678'), true, 'hidden digits are skipped');
  assert.equal(numbersMatch('•••• 5678', '01012345678'), true, 'last 4 digits are enough');
  assert.equal(numbersMatch('010****5679', '01012345678'), false, 'a visible digit differs');
  assert.equal(numbersMatch('01112345678', '01012345678'), false);
  assert.equal(numbersMatch('****78', '01012345678'), null, 'too few digits to tell');
  assert.equal(numbersMatch('', '01012345678'), null);
});
