import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Student } from './schemas/student.schema';
import { Class } from '../classes/schemas/class.schema';
import { GradeLevel } from '../grade-levels/schemas/grade-level.schema';
import { Stage } from '../stages/schemas/stage.schema';
import { AcademicYear } from '../academic-years/schemas/academic-year.schema';
import { School } from '../platform/schools/schemas/school.schema';
import { TenantContextService } from '../tenancy/tenant-context.service';
import { NATIONALITIES, resolveNationalityCode } from '../common/constants/nationalities.constant';

export interface StudentStatisticsFilters {
  stageId?: string;
  gradeLevelId?: string;
  classId?: string;
  gender?: string;
  /** `saudi`, `non_saudi`, `unspecified`, or an ISO code such as `EG`. */
  nationality?: string;
}

export interface StatisticsCounts {
  total: number;
  male: number;
  female: number;
  saudi: number;
  nonSaudi: number;
  unspecifiedNationality: number;
  maleSaudi: number;
  maleNonSaudi: number;
  femaleSaudi: number;
  femaleNonSaudi: number;
}

const SAUDI = 'SA';

const emptyCounts = (): StatisticsCounts => ({
  total: 0,
  male: 0,
  female: 0,
  saudi: 0,
  nonSaudi: 0,
  unspecifiedNationality: 0,
  maleSaudi: 0,
  maleNonSaudi: 0,
  femaleSaudi: 0,
  femaleNonSaudi: 0,
});

interface CountedStudent {
  gender: 'male' | 'female';
  nationalityCode: string | null;
}

function add(counts: StatisticsCounts, s: CountedStudent) {
  counts.total++;
  counts[s.gender]++;
  if (!s.nationalityCode) {
    counts.unspecifiedNationality++;
  } else if (s.nationalityCode === SAUDI) {
    counts.saudi++;
    counts[s.gender === 'male' ? 'maleSaudi' : 'femaleSaudi']++;
  } else {
    counts.nonSaudi++;
    counts[s.gender === 'male' ? 'maleNonSaudi' : 'femaleNonSaudi']++;
  }
}

/**
 * Head counts of the current year's students, broken down by stage, grade,
 * class and nationality, for the school's statistical reports.
 *
 * Every breakdown is taken after the filters, so they combine: filtering on
 * `non_saudi` gives the non-Saudis per class, and filtering on a stage gives
 * that stage's nationalities. Stages, grades and classes with no matching
 * student are still listed with zeros, because a report that drops an empty
 * class reads as if the class did not exist.
 */
@Injectable()
export class StudentStatisticsService {
  constructor(
    @InjectModel(Student.name) private studentModel: Model<Student>,
    @InjectModel(Class.name) private classModel: Model<Class>,
    @InjectModel(GradeLevel.name) private gradeLevelModel: Model<GradeLevel>,
    @InjectModel(Stage.name) private stageModel: Model<Stage>,
    @InjectModel(AcademicYear.name) private academicYearModel: Model<AcademicYear>,
    @InjectModel(School.name) private schoolModel: Model<School>,
    private tenantContext: TenantContextService,
  ) {}

  async getStatistics(query: StudentStatisticsFilters = {}) {
    // An empty select on the page sends `?gender=`; that means no filter, not "nobody".
    const filters: StudentStatisticsFilters = Object.fromEntries(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    this.validate(filters);

    const year = await this.academicYearModel
      .findOne({ status: 'active' })
      .select('_id name')
      .lean()
      .exec();
    if (!year) {
      throw new BadRequestException('لا توجد سنة دراسية نشطة لعرض إحصائياتها');
    }

    const [stages, gradeLevels, allClasses] = await Promise.all([
      this.stageModel.find().select('_id name order').sort({ order: 1 }).lean().exec(),
      this.gradeLevelModel.find().select('_id name order stageId').sort({ order: 1 }).lean().exec(),
      this.classModel
        .find({ academicYearId: year._id })
        .select('_id name gradeLevelId gender')
        .sort({ name: 1 })
        .lean()
        .exec(),
    ]);

    const gradeById = new Map(gradeLevels.map((g: any) => [String(g._id), g]));
    const stageById = new Map(stages.map((s: any) => [String(s._id), s]));

    const classes = allClasses.filter((c: any) => {
      const grade = gradeById.get(String(c.gradeLevelId));
      if (filters.classId && String(c._id) !== filters.classId) return false;
      if (filters.gradeLevelId && String(c.gradeLevelId) !== filters.gradeLevelId) return false;
      if (filters.stageId && String(grade?.stageId) !== filters.stageId) return false;
      return true;
    });

    const students = await this.studentModel
      .find({ classId: { $in: classes.map((c: any) => c._id) }, isActive: { $ne: false } })
      .select('_id classId gender nationality nationalityCode')
      .lean()
      .exec();

    const total = emptyCounts();
    const byClassId = new Map<string, StatisticsCounts>(classes.map((c: any) => [String(c._id), emptyCounts()]));
    const byNationality = new Map<string | null, { male: number; female: number; total: number }>();

    for (const raw of students as any[]) {
      const s: CountedStudent = {
        gender: raw.gender === 'male' ? 'male' : 'female',
        nationalityCode: resolveNationalityCode(raw.nationalityCode, raw.nationality),
      };
      if (!this.matches(s, filters)) continue;

      add(total, s);
      add(byClassId.get(String(raw.classId))!, s);

      const n = byNationality.get(s.nationalityCode) ?? { male: 0, female: 0, total: 0 };
      n[s.gender]++;
      n.total++;
      byNationality.set(s.nationalityCode, n);
    }

    const byClass = classes.map((c: any) => {
      const grade = gradeById.get(String(c.gradeLevelId));
      const stage = grade ? stageById.get(String(grade.stageId)) : undefined;
      return {
        classId: String(c._id),
        name: c.name,
        classGender: c.gender,
        gradeLevelId: String(c.gradeLevelId),
        gradeLevelName: grade?.name ?? null,
        stageId: stage ? String(stage._id) : null,
        stageName: stage?.name ?? null,
        ...byClassId.get(String(c._id))!,
      };
    });

    const byGradeLevel = gradeLevels
      .filter((g: any) => byClass.some((c) => c.gradeLevelId === String(g._id)))
      .map((g: any) => ({
        gradeLevelId: String(g._id),
        name: g.name,
        stageId: String(g.stageId),
        stageName: stageById.get(String(g.stageId))?.name ?? null,
        classCount: byClass.filter((c) => c.gradeLevelId === String(g._id)).length,
        ...this.sum(byClass.filter((c) => c.gradeLevelId === String(g._id))),
      }));

    const byStage = stages
      .filter((s: any) => byGradeLevel.some((g) => g.stageId === String(s._id)))
      .map((s: any) => ({
        stageId: String(s._id),
        name: s.name,
        classCount: byClass.filter((c) => c.stageId === String(s._id)).length,
        ...this.sum(byClass.filter((c) => c.stageId === String(s._id))),
      }));

    const labelByCode = new Map(NATIONALITIES.map((n) => [n.code, n.labelAr]));
    const nationalities = [...byNationality.entries()]
      .map(([code, n]) => ({
        code,
        label: code ? labelByCode.get(code) ?? code : 'غير محدد',
        isSaudi: code === SAUDI,
        ...n,
      }))
      .sort((a, b) => (a.code === null ? 1 : b.code === null ? -1 : b.total - a.total));

    // For the printed report's heading.
    const schoolId = this.tenantContext.getSchoolId();
    const school = schoolId
      ? await this.schoolModel.findById(schoolId).select('name').setOptions({ skipTenantScope: true }).lean().exec()
      : null;

    return {
      school: { name: (school as any)?.name ?? null },
      academicYear: { _id: String(year._id), name: (year as any).name },
      filters,
      total,
      byStage,
      byGradeLevel,
      byClass,
      byNationality: nationalities,
    };
  }

  private matches(s: CountedStudent, filters: StudentStatisticsFilters): boolean {
    if (filters.gender && s.gender !== filters.gender) return false;
    switch (filters.nationality) {
      case undefined:
        return true;
      case 'saudi':
        return s.nationalityCode === SAUDI;
      case 'non_saudi':
        return !!s.nationalityCode && s.nationalityCode !== SAUDI;
      case 'unspecified':
        return !s.nationalityCode;
      default:
        return s.nationalityCode === filters.nationality;
    }
  }

  private sum(rows: StatisticsCounts[]): StatisticsCounts {
    const out = emptyCounts();
    for (const r of rows) {
      for (const k of Object.keys(out) as (keyof StatisticsCounts)[]) out[k] += r[k];
    }
    return out;
  }

  private validate(filters: StudentStatisticsFilters) {
    for (const key of ['stageId', 'gradeLevelId', 'classId'] as const) {
      if (filters[key] && !Types.ObjectId.isValid(filters[key]!)) {
        throw new BadRequestException(`قيمة ${key} غير صالحة`);
      }
    }
    if (filters.gender && !['male', 'female'].includes(filters.gender)) {
      throw new BadRequestException('قيمة الجنس يجب أن تكون male أو female');
    }
    if (filters.nationality) {
      const n = filters.nationality;
      const isCode = /^[A-Za-z]{2}$/.test(n);
      if (isCode) filters.nationality = n.toUpperCase();
      if (!['saudi', 'non_saudi', 'unspecified'].includes(n) && !isCode) {
        throw new BadRequestException('قيمة الجنسية يجب أن تكون saudi أو non_saudi أو unspecified أو رمز دولة');
      }
    }
  }
}
