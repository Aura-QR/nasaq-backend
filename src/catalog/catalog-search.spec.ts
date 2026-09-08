import { ValidationPipe, BadRequestException } from '@nestjs/common';
import mongoose, { Model } from 'mongoose';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import {
  CatalogSubject,
  CatalogSubjectSchema,
} from './schemas/catalog-subject.schema';
import { CatalogUnit, CatalogUnitSchema } from './schemas/catalog-unit.schema';
import {
  CatalogLesson,
  CatalogLessonSchema,
} from './schemas/catalog-lesson.schema';

const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nasaq-test';

/**
 * Finding one course among 162.
 *
 * The first block runs the request through the pipe rather than the service,
 * because the defect it exists for lives between the two. `q` began life as a
 * loose `@Query('q')` beside a validated `PaginationDto`, and the global pipe
 * runs with `forbidNonWhitelisted` — so every search came back
 * `400 property q should not exist` and the parameter never reached the
 * handler at all. Testing the service alone passes straight through that.
 *
 * The pipe is exercised directly, with the settings main.ts installs, instead
 * of by standing up an HTTP app: a third Nest application in this process
 * shifts Jest's suite ordering, and the integration suites are not isolated
 * enough to survive being run in a different order.
 */
describe('catalog search', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const asQuery = (value: any) =>
    pipe.transform(value, { type: 'query', metatype: CatalogQueryDto } as any);

  describe('the query the controller accepts', () => {
    it('lets q through', async () => {
      await expect(asQuery({ q: 'رياضيات' })).resolves.toMatchObject({
        q: 'رياضيات',
      });
    });

    it('still takes page and limit', async () => {
      const result: any = await asQuery({ q: 'علوم', page: '2', limit: '5' });
      expect(result).toMatchObject({ q: 'علوم', page: 2, limit: 5 });
    });

    it('is fine without q', async () => {
      await expect(asQuery({})).resolves.toBeDefined();
    });

    it('still refuses a key nobody declared', async () => {
      // The pipe is doing its job. The fix was to declare q, not to loosen it.
      await expect(asQuery({ nonsense: '1' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('what it returns', () => {
    let service: CatalogService;
    let subjects: Model<CatalogSubject>;
    let units: Model<CatalogUnit>;
    let lessons: Model<CatalogLesson>;

    const seed = (id: string, name: string, unit: string, names: string[]) =>
      service.seedSubject({
        subjectId: id,
        subjectName: name,
        subjectVariant: unit,
        lessons: names.map((lessonName, i) => ({
          id: `${id},1,${i + 1}`,
          unit,
          lessonName,
        })),
      } as any);

    beforeAll(async () => {
      await mongoose.connect(URI);
      subjects =
        (mongoose.models[CatalogSubject.name] as Model<CatalogSubject>) ||
        mongoose.model(CatalogSubject.name, CatalogSubjectSchema);
      units =
        (mongoose.models[CatalogUnit.name] as Model<CatalogUnit>) ||
        mongoose.model(CatalogUnit.name, CatalogUnitSchema);
      lessons =
        (mongoose.models[CatalogLesson.name] as Model<CatalogLesson>) ||
        mongoose.model(CatalogLesson.name, CatalogLessonSchema);
      service = new CatalogService(subjects, units, lessons);
    });

    afterAll(async () => {
      await mongoose.disconnect();
    });

    beforeEach(async () => {
      await Promise.all([
        subjects.deleteMany({}),
        units.deleteMany({}),
        lessons.deleteMany({}),
      ]);
      await seed('900301', 'الرياضيات', 'الإحصاء والاحتمال', [
        'المتوسط الحسابي',
        'التمثيل بالأعمدة',
      ]);
      await seed('900302', 'الرياضيات', 'الكسور الاعتيادية', ['جمع الكسور']);
      await seed('900303', 'العلوم', 'دراسة المادة', ['حالات المادة']);
    });

    it('matches the subject', async () => {
      const page = await service.listSubjects({}, 'رياضيات');
      expect(page.totalDocs).toBe(2);
      expect(page.data.every((s: any) => s.name === 'الرياضيات')).toBe(true);
    });

    it('matches the variant too, which is how two courses of one subject differ', async () => {
      const page = await service.listSubjects({}, 'الكسور');
      expect(page.totalDocs).toBe(1);
      expect((page.data[0] as any).variant).toBe('الكسور الاعتيادية');
    });

    it('pages a filtered list', async () => {
      const page = await service.listSubjects({ limit: 1 }, 'رياضيات');
      expect(page.data).toHaveLength(1);
      expect(page.totalDocs).toBe(2);
    });

    it('returns everything with no term', async () => {
      expect((await service.listSubjects({})).totalDocs).toBe(3);
    });

    it('treats a term that matches nothing as empty, not as an error', async () => {
      expect((await service.listSubjects({}, 'لا-يوجد')).data).toEqual([]);
    });

    it('takes a term containing regex characters literally', async () => {
      // Real course labels carry these: "IT’S A GOOD DEAL , ISN’T IT?" and
      // "(أتحكم بحاسوبي) البرمجة". An unescaped ( or ? throws out of the driver.
      await seed('900304', 'الحاسب والتقنية', '(أتحكم بحاسوبي) البرمجة', [
        'المتغيرات',
      ]);
      expect((await service.listSubjects({}, '(أتحكم')).totalDocs).toBe(1);
      await expect(service.listSubjects({}, '?')).resolves.toBeDefined();
    });

    it('carries what a picker needs to tell two courses apart', async () => {
      const page = await service.listSubjects({}, 'الإحصاء');
      expect(page.data[0]).toMatchObject({
        name: 'الرياضيات',
        variant: 'الإحصاء والاحتمال',
        unitCount: 1,
        lessonCount: 2,
        unitPreview: ['الإحصاء والاحتمال'],
      });
    });
  });
});
