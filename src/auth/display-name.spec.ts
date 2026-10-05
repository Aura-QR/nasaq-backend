import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

/**
 * «Reviewed by» was blank everywhere: services wrote `user.name`, and the
 * token never carried a name. The name now travels in the token.
 */
describe('the name carried in the token', () => {
  it('uses an admin\'s full name, falling back to the username', () => {
    expect(AuthService.displayName({ fullName: 'محمد السيد', username: 'guard01' })).toBe('محمد السيد');
    expect(AuthService.displayName({ fullName: '', username: 'mgr1' })).toBe('mgr1');
  });

  it('uses a teacher\'s name and a student\'s first and family name', () => {
    expect(AuthService.displayName({ name: 'أ. أروى' })).toBe('أ. أروى');
    expect(AuthService.displayName({ firstName: 'سارة', familyName: 'العتيبي' })).toBe('سارة العتيبي');
  });

  it('is absent rather than an empty string when there is nothing to show', () => {
    expect(AuthService.displayName({})).toBeUndefined();
  });

  it('reaches request.user, and is undefined on a token signed before it existed', async () => {
    const strategy = Object.create(JwtStrategy.prototype) as JwtStrategy;
    const base = { sub: 'u1', email: 'a@b.c', role: 'OWNER', schoolId: 's1' };
    expect((await strategy.validate({ ...base, name: 'المالكة' } as any)).name).toBe('المالكة');
    expect((await strategy.validate(base as any)).name).toBeUndefined();
  });
});
