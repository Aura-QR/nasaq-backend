import { randomInt } from 'crypto';

/**
 * One-time password generation, in one place.
 *
 * The OTP was hardcoded to '000000' in two separate files — the
 * forgot-password flow and the student first-password flow — each with a
 * "Fixed for testing environment" comment. Both were reachable in production,
 * so anyone who knew an email address could reset that account's password.
 *
 * Testing still needs a predictable code, so that is opt-in through
 * OTP_FIXED_CODE rather than the default. Absent the variable, the code is
 * random.
 */

/** Minutes an OTP stays valid. Matches the message shown to the user. */
export const OTP_TTL_MINUTES = 15;

export function generateOtp(): string {
  const fixed = process.env.OTP_FIXED_CODE?.trim();

  if (fixed) {
    if (process.env.NODE_ENV === 'production') {
      // A fixed code in production is a way in for anyone who knows an email
      // address. Refuse rather than quietly honouring it.
      console.error(
        '❌ OTP_FIXED_CODE is set while NODE_ENV=production. Ignoring it and generating a random code.',
      );
    } else {
      console.warn(`⚠️  Using fixed OTP "${fixed}" — OTP_FIXED_CODE is set.`);
      return fixed;
    }
  }

  // randomInt is drawn from the CSPRNG. Math.random() is predictable from
  // previous outputs, which for a password-reset code is the whole problem.
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function otpExpiry(): Date {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}
