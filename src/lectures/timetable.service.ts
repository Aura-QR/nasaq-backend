import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { Lecture } from './schemas/lecture.schema';
import { Class } from '../classes/schemas/class.schema';
import { SubjectOffering } from '../subject-offerings/schemas/subject-offering.schema';
import { TeacherAssignment } from '../teacher-assignments/schemas/teacher-assignment.schema';
import { Term } from '../terms/schemas/term.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { School } from '../platform/schools/schemas/school.schema';

/** One class's need for one subject, and who is expected to teach it. */
export interface Requirement {
  classId: string;
  className: string;
  subjectOfferingId: string;
  subjectName: string;
  gradeLevelId: string;
  teacherId: string | null;
  teacherName: string | null;
  periodsPerWeek: number;
}

export type ProblemType =
  | 'no_working_days'
  | 'nothing_planned'
  | 'class_overbooked'
  | 'teacher_overloaded'
  | 'subject_unassigned'
  | 'assignment_shared';

export interface Problem {
  type: ProblemType;
  message: string;
  blocking: boolean;
  [key: string]: any;
}

@Injectable()
export class TimetableService {
  constructor(
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
    @InjectModel(Class.name) private readonly classModel: Model<Class>,
    @InjectModel(SubjectOffering.name)
    private readonly subjectOfferingModel: Model<SubjectOffering>,
    @InjectModel(TeacherAssignment.name)
    private readonly teacherAssignmentModel: Model<TeacherAssignment>,
    @InjectModel(Term.name) private readonly termModel: Model<Term>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
    @InjectModel(School.name) private readonly schoolModel: Model<School>,
  ) {}

  /**
   * How many teaching slots a week holds, per class.
   *
   * An empty `workSchedule` means the school never configured one. Rather than
   * refuse, fall back to a five-day week — the same "assume every day works"
   * stance the attendance code already takes for an unconfigured school.
   */
  async getCapacity(schoolId: any) {
    const school: any = await this.schoolModel
      .findById(schoolId)
      .select('settings.workSchedule settings.periodsPerDay')
      .lean()
      .exec();

    const schedule = school?.settings?.workSchedule ?? [];
    const periodsPerDay = school?.settings?.periodsPerDay ?? 7;

    const workingDays =
      schedule.length > 0
        ? schedule
            .filter((d: any) => d?.isWorkingDay !== false)
            .map((d: any) => d.day)
        : ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday'];

    return {
      workingDays,
      periodsPerDay,
      slotsPerWeek: workingDays.length * periodsPerDay,
      scheduleConfigured: schedule.length > 0,
    };
  }

  /**
   * Expands the teaching plan and the assignment sheet into the concrete list
   * of "this class needs N periods of this subject, taught by this teacher".
   *
   * Both the feasibility check and the generator run off this same list. If
   * they resolved teachers differently, a check that passed could still be
   * followed by a generation that failed, and nobody would trust either.
   */
  async buildRequirements(termId: string, classIds?: string[]) {
    const term: any = await this.termModel.findById(termId).lean().exec();
    if (!term) {
      throw new NotFoundException(`Term ${termId} not found`);
    }

    const classFilter: any = {
      academicYearId: term.academicYearId,
      isActive: true,
    };
    if (classIds?.length) {
      classFilter._id = { $in: classIds.map((id) => new mongoose.Types.ObjectId(id)) };
    }

    const classes: any[] = await this.classModel
      .find(classFilter)
      .select('name gradeLevelId roomNumber')
      .lean()
      .exec();

    if (classes.length === 0) {
      throw new BadRequestException(
        'No active classes found for this term. Create classes for the academic year first.',
      );
    }

    const offerings: any[] = await this.subjectOfferingModel
      .find({ termId: new mongoose.Types.ObjectId(termId) })
      .populate('subjectId', 'subjectName')
      .lean()
      .exec();

    const assignments: any[] = await this.teacherAssignmentModel
      .find({ subjectOfferingId: { $in: offerings.map((o) => o._id) } })
      .lean()
      .exec();

    const teachers: any[] = await this.teacherModel
      .find({ _id: { $in: assignments.map((a) => a.teacherId) } })
      .select('name specialization')
      .lean()
      .exec();
    const teacherById = new Map(teachers.map((t) => [String(t._id), t]));

    // Assignments for one offering, split into class-pinned and grade-wide.
    const byOffering = new Map<string, { pinned: Map<string, string>; open: string[] }>();
    for (const assignment of assignments) {
      const key = String(assignment.subjectOfferingId);
      if (!byOffering.has(key)) {
        byOffering.set(key, { pinned: new Map(), open: [] });
      }
      const entry = byOffering.get(key);
      if (assignment.classId) {
        entry.pinned.set(String(assignment.classId), String(assignment.teacherId));
      } else {
        entry.open.push(String(assignment.teacherId));
      }
    }
    // Sorted so a shared grade is split the same way on every run — a
    // generator that reshuffles teachers between previews is unusable.
    for (const entry of byOffering.values()) entry.open.sort();

    const offeringsByGrade = new Map<string, any[]>();
    for (const offering of offerings) {
      const key = String(offering.gradeLevelId);
      if (!offeringsByGrade.has(key)) offeringsByGrade.set(key, []);
      offeringsByGrade.get(key).push(offering);
    }

    const requirements: Requirement[] = [];
    const sharedOfferings: any[] = [];

    for (const offering of offerings) {
      const gradeClasses = classes.filter(
        (c) => String(c.gradeLevelId) === String(offering.gradeLevelId),
      );
      const entry = byOffering.get(String(offering._id));

      if (entry && entry.open.length > 1) {
        sharedOfferings.push({ offering, teacherIds: entry.open });
      }

      gradeClasses.forEach((cls, index) => {
        const classKey = String(cls._id);

        let teacherId: string | null = null;
        if (entry?.pinned.has(classKey)) {
          teacherId = entry.pinned.get(classKey);
        } else if (entry?.open.length === 1) {
          teacherId = entry.open[0];
        } else if (entry?.open.length > 1) {
          // Several teachers share the grade with nobody pinned. Spread the
          // sections round-robin rather than pile them on the first teacher.
          teacherId = entry.open[index % entry.open.length];
        }

        requirements.push({
          classId: classKey,
          className: cls.name,
          subjectOfferingId: String(offering._id),
          subjectName: offering.subjectId?.subjectName ?? '—',
          gradeLevelId: String(offering.gradeLevelId),
          teacherId,
          teacherName: teacherId ? (teacherById.get(teacherId)?.name ?? null) : null,
          periodsPerWeek: offering.periodsPerWeek ?? 0,
        });
      });
    }

    return { term, classes, offerings, requirements, sharedOfferings, teacherById };
  }

  /**
   * Pure arithmetic — no search. Answers "can a timetable exist at all?"
   *
   * A teacher needing more periods than the week holds is not a hard search
   * problem, it is a subtraction, and saying so up front is the difference
   * between a fixable message and a solver that just runs out of options.
   */
  async getFeasibility(
    termId: string,
    schoolId: any,
    classIds?: string[],
  ) {
    const capacity = await this.getCapacity(schoolId);
    const { classes, requirements, sharedOfferings } = await this.buildRequirements(
      termId,
      classIds,
    );

    const problems: Problem[] = [];

    if (capacity.workingDays.length === 0) {
      problems.push({
        type: 'no_working_days',
        message:
          'The school week has no working days configured, so there is nowhere to place a lesson.',
        blocking: true,
      });
    }

    const planned = requirements.filter((r) => r.periodsPerWeek > 0);
    if (planned.length === 0) {
      problems.push({
        type: 'nothing_planned',
        message:
          'No subject in this term has periodsPerWeek set. Fill in the teaching plan first.',
        blocking: true,
      });
    }

    // ---- per class ----
    const classRows = classes.map((cls: any) => {
      const demand = planned
        .filter((r) => r.classId === String(cls._id))
        .reduce((sum, r) => sum + r.periodsPerWeek, 0);

      const ok = demand <= capacity.slotsPerWeek;
      if (!ok) {
        problems.push({
          type: 'class_overbooked',
          message: `${cls.name} needs ${demand} periods a week but only has ${capacity.slotsPerWeek} slots.`,
          blocking: true,
          classId: String(cls._id),
          className: cls.name,
          required: demand,
          capacity: capacity.slotsPerWeek,
        });
      }

      return {
        classId: String(cls._id),
        name: cls.name,
        demand,
        capacity: capacity.slotsPerWeek,
        free: capacity.slotsPerWeek - demand,
        ok,
      };
    });

    // ---- per teacher ----
    const loadByTeacher = new Map<string, number>();
    for (const requirement of planned) {
      if (!requirement.teacherId) continue;
      loadByTeacher.set(
        requirement.teacherId,
        (loadByTeacher.get(requirement.teacherId) ?? 0) + requirement.periodsPerWeek,
      );
    }

    const nameByTeacher = new Map(
      planned
        .filter((r) => r.teacherId)
        .map((r) => [r.teacherId, r.teacherName ?? '—']),
    );

    const teacherRows = [...loadByTeacher.entries()]
      .map(([teacherId, load]) => {
        const ok = load <= capacity.slotsPerWeek;
        if (!ok) {
          problems.push({
            type: 'teacher_overloaded',
            message: `${nameByTeacher.get(teacherId)} is assigned ${load} periods a week but the week only holds ${capacity.slotsPerWeek}.`,
            blocking: true,
            teacherId,
            teacherName: nameByTeacher.get(teacherId),
            required: load,
            capacity: capacity.slotsPerWeek,
          });
        }
        return {
          teacherId,
          name: nameByTeacher.get(teacherId) ?? '—',
          load,
          capacity: capacity.slotsPerWeek,
          free: capacity.slotsPerWeek - load,
          ok,
        };
      })
      .sort((a, b) => b.load - a.load);

    // ---- subjects nobody teaches ----
    const unassigned = planned
      .filter((r) => !r.teacherId)
      .map((r) => ({
        classId: r.classId,
        className: r.className,
        subjectOfferingId: r.subjectOfferingId,
        subjectName: r.subjectName,
        periodsPerWeek: r.periodsPerWeek,
      }));

    if (unassigned.length > 0) {
      problems.push({
        type: 'subject_unassigned',
        // Not blocking: Lecture.teacherId is nullable and means "needs a
        // teacher", so these still get a slot and show up as a visible gap.
        message: `${unassigned.length} class-subject pairs have no teacher. They will be scheduled with an empty teacher.`,
        blocking: false,
        count: unassigned.length,
      });
    }

    for (const shared of sharedOfferings) {
      problems.push({
        type: 'assignment_shared',
        message: `${shared.offering.subjectId?.subjectName ?? 'A subject'} has ${shared.teacherIds.length} teachers assigned to the grade with none pinned to a class. Sections will be split between them in order; pin a class to control who takes which.`,
        blocking: false,
        subjectOfferingId: String(shared.offering._id),
        teacherCount: shared.teacherIds.length,
      });
    }

    const existing = await this.lectureModel.countDocuments({
      termId: new mongoose.Types.ObjectId(termId),
    });

    return {
      termId,
      ...capacity,
      totalPeriodsNeeded: planned.reduce((sum, r) => sum + r.periodsPerWeek, 0),
      existingLectures: existing,
      classes: classRows,
      teachers: teacherRows,
      unassignedSubjects: unassigned,
      feasible: problems.every((p) => !p.blocking),
      problems,
    };
  }
}
