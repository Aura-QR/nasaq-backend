import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';

export class PasswordUtil {
  private static readonly SALT_ROUNDS = 10;
  private static readonly ALPHABET =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

  static generate(): string {
    return Array.from(
      { length: 8 },
      () => this.ALPHABET[randomInt(this.ALPHABET.length)],
    ).join('');
  }

  static async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  static async compare(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }
}
