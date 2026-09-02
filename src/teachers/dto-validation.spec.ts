import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateTeacherDto } from './dto/create-teacher.dto';

/**
 * The message is the point. "each value must be a mongodb id" told a client
 * nothing about which of its twenty values was wrong, and cost an afternoon
 * of guessing from the outside.
 */
describe('CreateTeacherDto — subjectOfferingIds', () => {
  const messagesFor = async (subjectOfferingIds: any) => {
    const dto = plainToInstance(CreateTeacherDto, {
      name: 'أ. تجربة',
      email: 't@example.com',
      password: 'Secret123',
      subjectOfferingIds,
    });
    const errors = await validate(dto);
    return errors.flatMap((e) => Object.values(e.constraints ?? {}));
  };

  const VALID = '6a7cf76824073b40534ee760';

  it('accepts real object ids', async () => {
    expect(await messagesFor([VALID])).toEqual([]);
  });

  it('accepts an empty array — that is how a client clears assignments', async () => {
    expect(await messagesFor([])).toEqual([]);
  });

  it('names the one bad value among good ones', async () => {
    const messages = await messagesFor([VALID, 'الرياضيات']);
    expect(messages.join(' ')).toContain('الرياضيات');
    // and does not accuse the valid one
    expect(messages.join(' ')).not.toContain(VALID);
  });

  it('names an object that stringified to [object Object]', async () => {
    const messages = await messagesFor([VALID, '[object Object]']);
    expect(messages.join(' ')).toContain('[object Object]');
  });

  it('names undefined and null entries rather than hiding them', async () => {
    const messages = await messagesFor([null, undefined]);
    expect(messages.join(' ')).toMatch(/null|undefined/);
  });

  it('names every bad value, not just the first', async () => {
    const messages = await messagesFor(['aaa', 'bbb']);
    expect(messages.join(' ')).toContain('aaa');
    expect(messages.join(' ')).toContain('bbb');
  });

  it('rejects a 24-character string that is not hex', async () => {
    const messages = await messagesFor(['zzzzzzzzzzzzzzzzzzzzzzzz']);
    expect(messages.join(' ')).toContain('zzzz');
  });
});
