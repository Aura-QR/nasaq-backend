import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { VoidPaymentDto } from './dto/void-payment.dto';

/**
 * The body the web and the app send, through the same ValidationPipe settings
 * main.ts installs. With forbidNonWhitelisted, a property the DTO does not
 * declare rejects the whole request before the handler runs — the failure mode
 * that is invisible until someone presses the button.
 */
describe('VoidPaymentDto through the global ValidationPipe', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const meta: ArgumentMetadata = { type: 'body', metatype: VoidPaymentDto };
  const run = (body: any) => pipe.transform(body, meta);
  const id = '6a7064396923f767d2086399';

  it.each([
    ['tuition', { section: 'tuition', installmentNumber: 1, paymentIndex: 0, expectedAmount: 1000, reason: 'خطأ' }],
    ['bus', { section: 'bus', installmentNumber: 2, paymentIndex: 1, expectedAmount: 500, reason: 'خطأ' }],
    ['trip', { section: 'trip', tripId: id, installmentNumber: 1, paymentIndex: 0, expectedAmount: 200, reason: 'خطأ' }],
    ['additionalFee', { section: 'additionalFee', additionalFeeId: id, paymentIndex: 0, expectedAmount: 150, reason: 'خطأ' }],
  ])('accepts a %s void', async (_, body) => {
    await expect(run(body)).resolves.toBeInstanceOf(VoidPaymentDto);
  });

  it('trims the reason, and refuses one that is only spaces', async () => {
    const ok: any = await run({ section: 'tuition', installmentNumber: 1, paymentIndex: 0, expectedAmount: 1, reason: '  خطأ  ' });
    expect(ok.reason).toBe('خطأ');
    await expect(run({ section: 'tuition', installmentNumber: 1, paymentIndex: 0, expectedAmount: 1, reason: '   ' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it.each([
    ['a trip without its tripId', { section: 'trip', installmentNumber: 1, paymentIndex: 0, expectedAmount: 1, reason: 'x' }],
    ['an installment section without an installment', { section: 'tuition', paymentIndex: 0, expectedAmount: 1, reason: 'x' }],
    ['an additional fee without its id', { section: 'additionalFee', paymentIndex: 0, expectedAmount: 1, reason: 'x' }],
    ['a negative index', { section: 'tuition', installmentNumber: 1, paymentIndex: -1, expectedAmount: 1, reason: 'x' }],
    ['an unknown section', { section: 'library', installmentNumber: 1, paymentIndex: 0, expectedAmount: 1, reason: 'x' }],
    ['an undeclared field', { section: 'tuition', installmentNumber: 1, paymentIndex: 0, expectedAmount: 1, reason: 'x', amount: 5 }],
  ])('rejects %s', async (_, body) => {
    await expect(run(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
