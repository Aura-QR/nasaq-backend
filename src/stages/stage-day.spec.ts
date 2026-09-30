import { getDefaultPermissionsForRole } from '../permissions/default-permissions';
import { StageSchema } from './schemas/stage.schema';
import { LectureSchema } from '../lectures/schemas/lecture.schema';
import { SchoolSchema } from '../platform/schools/schemas/school.schema';

/**
 * A stage that runs its own school day.
 *
 * A kindergarten runs twelve to fourteen half-hour periods where a primary
 * runs eight. Before this, the number of periods was one setting for the
 * whole school, so مواهب المملكة could create its three KG grade levels and
 * then not build a timetable for them at all.
 *
 * What is asserted here is the part that protects everyone else: the fields
 * are null by default and null means "use the school's number", so no stage
 * that exists today changes and no migration is needed.
 */
describe('a stage with its own day', () => {
  const stagePath = (field: string) => (StageSchema as any).path(field);

  describe('the new fields default to null', () => {
    // This is the whole safety argument. If any of these defaulted to a
    // number, every stage in every school would silently adopt it.
    it.each(['periodsPerDay', 'startTime', 'endTime', 'periodMinutes'])(
      '%s defaults to null',
      (field) => {
        expect(stagePath(field)).toBeDefined();
        expect(stagePath(field).options.default).toBeNull();
      },
    );

    it('a stage created with only a name and order has no day of its own', () => {
      const doc: any = new (require('mongoose').model('StageDayProbe', StageSchema))({
        name: 'المرحلة الابتدائية',
        order: 1,
        schoolId: '6ab0000000000000000000aa',
      });
      expect(doc.periodsPerDay).toBeNull();
      expect(doc.periodMinutes).toBeNull();
    });
  });

  describe('the ceilings that were raised', () => {
    it('a lecture may now sit in period 14', () => {
      // The KG day in the photo runs to fourteen. Ten was the wall.
      expect(LectureSchema.path('slot').options.max).toBe(20);
    });

    it('a stage may be given up to 20 periods', () => {
      expect(stagePath('periodsPerDay').options.max).toBe(20);
      expect(stagePath('periodsPerDay').options.min).toBe(1);
    });

    it('the school-wide number also reaches 20', () => {
      expect(SchoolSchema.path('settings').schema.path('periodsPerDay').options.max).toBe(20);
    });

    it('a period is between 5 and 120 minutes', () => {
      // 30 for a kindergarten, 45 for a primary. The bounds only stop a typo.
      expect(stagePath('periodMinutes').options.min).toBe(5);
      expect(stagePath('periodMinutes').options.max).toBe(120);
    });
  });

  describe('how many periods a stage runs', () => {
    /**
     * The resolution the timetable will use, written out here first.
     *
     * Three levels, most specific wins — the same shape the passing grade
     * already uses: a single short day, then the stage, then the school.
     */
    const periodsFor = (
      day: { periodsPerDay?: number | null } | undefined,
      stage: { periodsPerDay?: number | null } | undefined,
      schoolPeriodsPerDay: number,
    ) => day?.periodsPerDay ?? stage?.periodsPerDay ?? schoolPeriodsPerDay;

    it('a stage with no number of its own follows the school', () => {
      // The case that covers every stage that exists today.
      expect(periodsFor(undefined, { periodsPerDay: null }, 8)).toBe(8);
    });

    it('a kindergarten on 14 gets 14 while the school stays on 8', () => {
      expect(periodsFor(undefined, { periodsPerDay: 14 }, 8)).toBe(14);
    });

    it('the primary is untouched by what the kindergarten was given', () => {
      const school = 8;
      expect(periodsFor(undefined, { periodsPerDay: 14 }, school)).toBe(14);
      expect(periodsFor(undefined, { periodsPerDay: null }, school)).toBe(8);
    });

    it('a short day still wins over the stage', () => {
      // مواهب runs six periods on Thursday against eight the rest of the
      // week. A KG Thursday must stay short too.
      expect(periodsFor({ periodsPerDay: 6 }, { periodsPerDay: 14 }, 8)).toBe(6);
    });

    it('a day that sets nothing falls through to the stage', () => {
      expect(periodsFor({ periodsPerDay: null }, { periodsPerDay: 14 }, 8)).toBe(14);
    });

    it('with nothing configured anywhere, the school decides', () => {
      expect(periodsFor(undefined, undefined, 7)).toBe(7);
    });
  });

  describe('editing a stage is an academic-structure action', () => {
    it('is not a new permission — the route already existed', () => {
      // PATCH /stages/:id is guarded by AcademicStructure, which a manager
      // already holds. Adding fields to it grants nobody anything new.
      const manager: any = getDefaultPermissionsForRole('MANAGER');
      expect(manager.academicStructure.edit).toBe(true);
    });

    it('a teacher cannot change a stage', () => {
      const teacher: any = getDefaultPermissionsForRole('TEACHER');
      expect(teacher.academicStructure).toBeUndefined();
    });
  });
});
