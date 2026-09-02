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
import { TeacherConstraint } from '../teacher-constraints/schemas/teacher-constraint.schema';
import { GenerateTimetableDto } from './dto/generate-timetable.dto';

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
  /** 'early' | 'any' | 'late' — where in the day this subject would rather sit. */
  slotPreference?: string;
  /**
   * Set only when this pair has no teacher for the term being generated, but
   * the same subject and grade IS assigned in another term. Turns a silent
   * gap into "the teacher is on Term 1, you are generating Term 2".
   */
  assignedInOtherTerm?: string | null;
}

export type ProblemType =
  | 'no_working_days'
  | 'nothing_planned'
  | 'class_overbooked'
  | 'teacher_overloaded'
  | 'subject_unassigned'
  | 'assignment_shared'
  | 'no_slot_left'
  | 'search_exhausted'
  | 'assignment_wrong_term'
  | 'assignment_pinned_elsewhere'
  | 'assignment_pin_conflict';

/** One period placed on the grid. */
interface Placement {
  classId: string;
  className: string;
  subjectOfferingId: string;
  subjectName: string;
  teacherId: string | null;
  teacherName: string | null;
  dayOfWeek: string;
  slot: number;
}

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
    @InjectModel(TeacherConstraint.name)
    private readonly teacherConstraintModel: Model<TeacherConstraint>,
  ) {}

  /**
   * "teacherId|day|slot" for every cell a teacher may not occupy this term.
   *
   * Flattened to one lookup set rather than kept as blocks: this is consulted
   * once per candidate slot per lesson, which is tens of thousands of times in
   * a normal run.
   */
  async loadTeacherBlocks(termId: string): Promise<Set<string>> {
    const rows = await this.teacherConstraintModel
      .find({ termId: new mongoose.Types.ObjectId(String(termId)) })
      .lean()
      .exec();

    const blocked = new Set<string>();
    for (const row of rows as any[]) {
      for (const block of row.unavailable ?? []) {
        if (!block?.day) continue;
        if (!block.slots?.length) {
          // No slots named means the whole day, however long the day is.
          blocked.add(`${String(row.teacherId)}|${block.day}|*`);
          continue;
        }
        for (const slot of block.slots) {
          blocked.add(`${String(row.teacherId)}|${block.day}|${slot}`);
        }
      }
    }
    return blocked;
  }

  /** Whether this teacher is barred from this cell. */
  private isBlocked(
    blocked: Set<string>,
    teacherId: string | null,
    day: string,
    slot: number,
  ): boolean {
    if (!teacherId || blocked.size === 0) return false;
    return (
      blocked.has(`${teacherId}|${day}|*`) ||
      blocked.has(`${teacherId}|${day}|${slot}`)
    );
  }

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

    // A day may run fewer periods than the rest of the week. Multiplying one
    // number by the day count would either waste the long days or schedule
    // lessons into periods the short day does not have.
    const periodsByDay: Record<string, number> = {};
    for (const day of workingDays) {
      const row = schedule.find((d: any) => d?.day === day);
      periodsByDay[day] = row?.periodsPerDay ?? periodsPerDay;
    }

    const slotsPerWeek = workingDays.reduce(
      (sum: number, day: string) => sum + periodsByDay[day],
      0,
    );

    return {
      workingDays,
      periodsPerDay,
      periodsByDay,
      // The longest day — a slot number can never exceed this anywhere.
      maxPeriodsPerDay: Math.max(periodsPerDay, ...Object.values(periodsByDay)),
      slotsPerWeek,
      uniformWeek: new Set(Object.values(periodsByDay)).size <= 1,
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

    /*
     * An offering is subject × grade × TERM, so an assignment made last term
     * points at a different offering id and cannot cover this one. That looks
     * identical to "nobody is assigned" and is the likeliest reason a section
     * comes back unstaffed while its neighbour resolves fine — so find those
     * rows and name the term, rather than leaving it a mystery.
     */
    const sameSubjectElsewhere: any[] = await this.subjectOfferingModel
      .find({
        termId: { $ne: new mongoose.Types.ObjectId(termId) },
        subjectId: { $in: offerings.map((o: any) => o.subjectId?._id ?? o.subjectId) },
        gradeLevelId: { $in: offerings.map((o: any) => o.gradeLevelId) },
      })
      .populate('termId', 'name order')
      .lean()
      .exec();

    const strandedAssignments: any[] =
      sameSubjectElsewhere.length === 0
        ? []
        : await this.teacherAssignmentModel
            .find({ subjectOfferingId: { $in: sameSubjectElsewhere.map((o) => o._id) } })
            .lean()
            .exec();

    const strandedKey = (subjectId: any, gradeLevelId: any) =>
      `${String(subjectId)}|${String(gradeLevelId)}`;
    const strandedBy = new Map<string, any>();
    for (const assignment of strandedAssignments) {
      const offering = sameSubjectElsewhere.find(
        (o) => String(o._id) === String(assignment.subjectOfferingId),
      );
      if (!offering) continue;
      strandedBy.set(strandedKey(offering.subjectId, offering.gradeLevelId), {
        termName: offering.termId?.name ?? null,
        teacherId: String(assignment.teacherId),
      });
    }

    const teachers: any[] = await this.teacherModel
      .find({ _id: { $in: assignments.map((a) => a.teacherId) } })
      .select('name specialization')
      .lean()
      .exec();
    const teacherById = new Map(teachers.map((t) => [String(t._id), t]));

    // Assignments for one offering, split into class-pinned and grade-wide.
    const byOffering = new Map<string, { pinned: Map<string, string>; open: string[] }>();
    const conflictingPins: any[] = [];
    for (const assignment of assignments) {
      const key = String(assignment.subjectOfferingId);
      if (!byOffering.has(key)) {
        byOffering.set(key, { pinned: new Map(), open: [] });
      }
      const entry = byOffering.get(key);
      if (assignment.classId) {
        const pinnedClass = String(assignment.classId);
        if (entry.pinned.has(pinnedClass)) {
          // Two teachers pinned to the same class: the second used to
          // overwrite the first with no trace, which reads as the first
          // teacher's assignment having vanished.
          conflictingPins.push({
            subjectOfferingId: key,
            classId: pinnedClass,
            teacherIds: [entry.pinned.get(pinnedClass), String(assignment.teacherId)],
          });
        }
        entry.pinned.set(pinnedClass, String(assignment.teacherId));
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
    const strayPins: any[] = [];

    for (const offering of offerings) {
      const gradeClasses = classes.filter(
        (c) => String(c.gradeLevelId) === String(offering.gradeLevelId),
      );
      const entry = byOffering.get(String(offering._id));

      if (entry && entry.open.length > 1) {
        sharedOfferings.push({ offering, teacherIds: entry.open });
      }

      if (entry) {
        const gradeClassIds = new Set(gradeClasses.map((c: any) => String(c._id)));
        for (const pinnedClassId of entry.pinned.keys()) {
          if (!gradeClassIds.has(pinnedClassId)) {
            strayPins.push({
              subjectOfferingId: String(offering._id),
              subjectName: offering.subjectId?.subjectName ?? null,
              classId: pinnedClassId,
              teacherId: entry.pinned.get(pinnedClassId),
            });
          }
        }
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
          slotPreference: offering.slotPreference ?? 'any',
          assignedInOtherTerm: teacherId
            ? null
            : (strandedBy.get(
                strandedKey(
                  offering.subjectId?._id ?? offering.subjectId,
                  offering.gradeLevelId,
                ),
              )?.termName ?? null),
        });
      });
    }

    return {
      term,
      classes,
      offerings,
      requirements,
      sharedOfferings,
      teacherById,
      byOffering,
      conflictingPins,
      strayPins,
    };
  }


  /**
   * Shows exactly what the teacher resolver sees, for one class.
   *
   * When a section comes back unstaffed and the data looks right on screen,
   * the answer is always in the difference between what the screen shows and
   * what the resolver reads: which offering an assignment actually points at,
   * whether its classId is null or set, and which grade a class really
   * belongs to. Guessing at that from the outside is what turned one field
   * report into a long exchange.
   */
  async traceAssignments(termId: string, classId: string, schoolId: any) {
    // Deliberately unfiltered: the whole point is to show whether a pin aims
    // at a class in this grade, which cannot be seen from inside a one-class
    // slice.
    const built = await this.buildRequirements(termId);
    const cls: any = built.classes.find((c: any) => String(c._id) === String(classId));

    if (!cls) {
      throw new NotFoundException(
        `Class ${classId} is not an active class in this term's academic year.`,
      );
    }

    const allAssignments: any[] = await this.teacherAssignmentModel
      .find({ teacherId: { $exists: true } })
      .populate('teacherId', 'name')
      .populate({
        path: 'subjectOfferingId',
        populate: [
          { path: 'subjectId', select: 'subjectName' },
          { path: 'gradeLevelId', select: 'name' },
          { path: 'termId', select: 'name order' },
        ],
      })
      .lean()
      .exec();

    const subjects = built.requirements
      .filter((r) => r.classId === String(classId))
      .map((requirement) => {
        const entry = (built.byOffering as any).get(requirement.subjectOfferingId);

        return {
          subjectName: requirement.subjectName,
          subjectOfferingId: requirement.subjectOfferingId,
          periodsPerWeek: requirement.periodsPerWeek,
          resolvedTeacherId: requirement.teacherId,
          resolvedTeacherName: requirement.teacherName,
          resolvedBy: requirement.teacherId
            ? entry?.pinned?.has(String(classId))
              ? 'pinned to this class'
              : entry?.open?.length === 1
                ? 'grade-wide assignment'
                : 'grade-wide, shared round-robin'
            : 'nothing matched',
          assignmentsOnThisOffering: {
            pinnedToAClass: [...(entry?.pinned?.entries() ?? [])].map(
              ([pinnedClassId, teacherId]) => ({
                classId: pinnedClassId,
                isThisClass: String(pinnedClassId) === String(classId),
                teacherId,
                teacherName: (built.teacherById as any).get(teacherId)?.name ?? null,
              }),
            ),
            gradeWide: (entry?.open ?? []).map((teacherId: string) => ({
              teacherId,
              teacherName: (built.teacherById as any).get(teacherId)?.name ?? null,
            })),
          },
        };
      });

    // Every assignment in the school, so a row pointing at the wrong term or
    // the wrong grade is visible rather than inferred.
    const allRows = allAssignments.map((a: any) => ({
      assignmentId: String(a._id),
      teacherName: a.teacherId?.name ?? null,
      subjectName: a.subjectOfferingId?.subjectId?.subjectName ?? null,
      gradeName: a.subjectOfferingId?.gradeLevelId?.name ?? null,
      gradeLevelId: String(a.subjectOfferingId?.gradeLevelId?._id ?? ''),
      termName: a.subjectOfferingId?.termId?.name ?? null,
      termId: String(a.subjectOfferingId?.termId?._id ?? ''),
      subjectOfferingId: String(a.subjectOfferingId?._id ?? a.subjectOfferingId),
      classId: a.classId ? String(a.classId) : null,
      classIdPresent: Object.prototype.hasOwnProperty.call(a, 'classId'),
      matchesThisTerm: String(a.subjectOfferingId?.termId?._id ?? '') === String(termId),
      matchesThisGrade:
        String(a.subjectOfferingId?.gradeLevelId?._id ?? '') === String(cls.gradeLevelId),
    }));

    return {
      class: {
        classId: String(cls._id),
        name: cls.name,
        gradeLevelId: String(cls.gradeLevelId),
      },
      termId,
      classesInThisGrade: built.classes
        .filter((c: any) => String(c.gradeLevelId) === String(cls.gradeLevelId))
        .map((c: any) => ({ classId: String(c._id), name: c.name })),
      subjects,
      allAssignmentsInSchool: allRows,
      hint:
        'For a subject resolving to nothing: find its rows in ' +
        'allAssignmentsInSchool and check matchesThisTerm and matchesThisGrade. ' +
        'A row with classId set to a class not listed in classesInThisGrade is ' +
        'pinned somewhere it cannot apply.',
    };
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
    const { classes, requirements, sharedOfferings, conflictingPins, strayPins } =
      await this.buildRequirements(termId, classIds);

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

    // A teacher's real ceiling is the week minus whatever they blocked out, not
    // the whole week. Checking against the whole week would pass someone who is
    // available two days and assigned thirty periods.
    const teacherBlocks = await this.loadTeacherBlocks(termId);
    const availableSlotsFor = (teacherId: string) => {
      if (teacherBlocks.size === 0) return capacity.slotsPerWeek;
      let free = 0;
      for (const day of capacity.workingDays) {
        for (let slot = 1; slot <= capacity.periodsByDay[day]; slot++) {
          if (!this.isBlocked(teacherBlocks, teacherId, day, slot)) free++;
        }
      }
      return free;
    };

    const teacherRows = [...loadByTeacher.entries()]
      .map(([teacherId, load]) => {
        const available = availableSlotsFor(teacherId);
        const ok = load <= available;
        if (!ok) {
          const constrained = available < capacity.slotsPerWeek;
          problems.push({
            type: 'teacher_overloaded',
            message: constrained
              ? `${nameByTeacher.get(teacherId)} is assigned ${load} periods a week but is only available for ${available} after their unavailability is taken out.`
              : `${nameByTeacher.get(teacherId)} is assigned ${load} periods a week but the week only holds ${capacity.slotsPerWeek}.`,
            blocking: true,
            teacherId,
            teacherName: nameByTeacher.get(teacherId),
            required: load,
            capacity: available,
            constrained,
          });
        }
        return {
          teacherId,
          name: nameByTeacher.get(teacherId) ?? '—',
          load,
          capacity: available,
          free: available - load,
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
        assignedInOtherTerm: r.assignedInOtherTerm ?? null,
      }));

    const stranded = unassigned.filter((u) => u.assignedInOtherTerm);
    if (stranded.length > 0) {
      problems.push({
        type: 'assignment_wrong_term',
        message: `${stranded.length} class-subject pairs have no teacher this term, but the same subject is assigned in ${[...new Set(stranded.map((s) => s.assignedInOtherTerm))].join(', ')}. An assignment belongs to one term — re-assign for this one.`,
        blocking: false,
        count: stranded.length,
        terms: [...new Set(stranded.map((s) => s.assignedInOtherTerm))],
      });
    }

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

    if (strayPins.length > 0) {
      problems.push({
        type: 'assignment_pinned_elsewhere',
        message: `${strayPins.length} assignments are pinned to a class that is not in the subject's grade, so they can never apply. The teacher looks assigned on screen and covers nothing.`,
        blocking: false,
        count: strayPins.length,
        details: strayPins.slice(0, 20),
      });
    }

    if (conflictingPins.length > 0) {
      problems.push({
        type: 'assignment_pin_conflict',
        message: `${conflictingPins.length} classes have two teachers pinned to the same subject. Only the last one counts — remove one.`,
        blocking: false,
        count: conflictingPins.length,
        details: conflictingPins.slice(0, 20),
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

  /**
   * Builds a timetable for the term.
   *
   * The search is greedy with bounded backtracking, ordered most-constrained
   * first: the periods belonging to the busiest teachers go down before the
   * easy ones, because those are what run out of room if left until last.
   *
   * Hard constraints are checked here and enforced again by the unique indexes
   * on Lecture, so a bug in the search cannot produce a double-booking — the
   * write is simply rejected.
   *
   * `preview` returns the grid and writes nothing.
   */
  async generate(dto: GenerateTimetableDto, schoolId: any) {
    const mode = dto.mode ?? 'preview';
    const onExisting = dto.onExisting ?? 'skip';
    const maxSamePerDay = dto.maxSamePerDay ?? 1;
    const includeUnstaffed = dto.includeUnstaffed ?? true;

    const capacity = await this.getCapacity(schoolId);
    const { requirements } = await this.buildRequirements(dto.termId, dto.classIds);

    const problems: Problem[] = [];

    if (capacity.workingDays.length === 0) {
      throw new BadRequestException(
        'The school week has no working days configured, so there is nowhere to place a lesson.',
      );
    }

    // ---- decide which classes we are allowed to touch ----
    const termObjectId = new mongoose.Types.ObjectId(dto.termId);
    const existing = await this.lectureModel
      .find({ termId: termObjectId })
      .select('classId teacherId dayOfWeek slot')
      .lean()
      .exec();

    const classesWithLectures = new Set(existing.map((l: any) => String(l.classId)));
    const skipped: string[] = [];

    let planned = requirements.filter((r) => r.periodsPerWeek > 0);
    if (!includeUnstaffed) {
      planned = planned.filter((r) => r.teacherId);
    }

    if (onExisting === 'skip') {
      const before = new Set(planned.map((r) => r.classId));
      planned = planned.filter((r) => !classesWithLectures.has(r.classId));
      for (const classId of before) {
        if (classesWithLectures.has(classId)) skipped.push(classId);
      }
    }

    if (planned.length === 0) {
      return {
        mode,
        termId: dto.termId,
        ...capacity,
        placed: 0,
        unplaced: 0,
        skippedClasses: skipped.length,
        classes: [],
        problems: [
          {
            type: 'nothing_planned' as ProblemType,
            message:
              skipped.length > 0
                ? 'Every class in scope already has a timetable. Use onExisting: "replace" to rebuild them.'
                : 'Nothing to schedule: no subject in this term has periodsPerWeek set.',
            blocking: true,
          },
        ],
        written: false,
      };
    }

    // ---- expand each requirement into individual periods ----
    const loadByTeacher = new Map<string, number>();
    for (const requirement of planned) {
      if (!requirement.teacherId) continue;
      loadByTeacher.set(
        requirement.teacherId,
        (loadByTeacher.get(requirement.teacherId) ?? 0) + requirement.periodsPerWeek,
      );
    }

    // How full each class's week has to be. A class needing 37 of 38 slots has
    // almost no choice about where anything goes, so it must claim its slots
    // before a roomier class takes the ones its shared teachers need.
    const demandByClass = new Map<string, number>();
    for (const requirement of planned) {
      demandByClass.set(
        requirement.classId,
        (demandByClass.get(requirement.classId) ?? 0) + requirement.periodsPerWeek,
      );
    }

    // Hardest first, and the tightest class is harder than the busiest
    // teacher. Ordering by teacher load alone left a subject taught by a
    // mid-load teacher to the fullest class in the school until late, by which
    // point that class's few free periods and the teacher's few free periods
    // no longer overlapped and it could not be placed at all.
    const ordered = [...planned].sort((a, b) => {
      const tightA = demandByClass.get(a.classId) ?? 0;
      const tightB = demandByClass.get(b.classId) ?? 0;
      if (tightB !== tightA) return tightB - tightA;

      const loadA = a.teacherId ? loadByTeacher.get(a.teacherId) ?? 0 : -1;
      const loadB = b.teacherId ? loadByTeacher.get(b.teacherId) ?? 0 : -1;
      if (loadB !== loadA) return loadB - loadA;
      if (b.periodsPerWeek !== a.periodsPerWeek) return b.periodsPerWeek - a.periodsPerWeek;
      // Deterministic tiebreak: two identical previews must be identical.
      return a.classId.localeCompare(b.classId) || a.subjectOfferingId.localeCompare(b.subjectOfferingId);
    });

    const units: Requirement[] = [];
    for (const requirement of ordered) {
      for (let i = 0; i < requirement.periodsPerWeek; i++) units.push(requirement);
    }

    const slots: { day: string; slot: number }[] = [];
    for (const day of capacity.workingDays) {
      for (let slot = 1; slot <= capacity.periodsByDay[day]; slot++) {
        slots.push({ day, slot });
      }
    }
    const teacherBlocks = await this.loadTeacherBlocks(dto.termId);

    const state = {
      classBusy: new Map<string, Set<string>>(),
      teacherBusy: new Map<string, Set<string>>(),
      subjectPerDay: new Map<string, number>(),
    };

    /**
     * A teacher already standing in a classroom we are not rebuilding is not
     * free, however little we intend to touch that class.
     *
     * Existing lectures were read only to decide which classes to skip. Their
     * teachers were then treated as available, so the solver planned lessons
     * on top of them and the unique index rejected the writes — six of them on
     * a real school. Nothing corrupt landed, but six periods were lost and the
     * preview had promised them.
     *
     * Lectures belonging to classes being replaced are deleted before the
     * write, so those slots really are free and are left out here.
     */
    const replacing = onExisting === 'replace'
      ? new Set(planned.map((r) => r.classId))
      : new Set<string>();

    for (const lecture of existing as any[]) {
      if (!lecture.teacherId) continue;
      if (replacing.has(String(lecture.classId))) continue;
      const teacherId = String(lecture.teacherId);
      const cell = `${lecture.dayOfWeek}:${lecture.slot}`;
      if (!state.teacherBusy.has(teacherId)) state.teacherBusy.set(teacherId, new Set());
      state.teacherBusy.get(teacherId).add(cell);
    }

    const placements: Placement[] = [];
    const unplaced: Requirement[] = [];

    // A cap, not a correctness bound: school instances are small, and an
    // instance that needs more than this is one the report should describe
    // rather than one the server should keep grinding on.
    let budget = 200_000;

    const key = (day: string, slot: number) => `${day}:${slot}`;
    const dayKey = (r: Requirement, day: string) =>
      `${r.classId}|${r.subjectOfferingId}|${day}`;

    const isFree = (requirement: Requirement, day: string, slot: number) => {
      const cell = key(day, slot);
      if (state.classBusy.get(requirement.classId)?.has(cell)) return false;
      if (requirement.teacherId && state.teacherBusy.get(requirement.teacherId)?.has(cell)) {
        return false;
      }
      // A declared unavailability is a rule, not a preference — a teacher who
      // is not in the building cannot be given a lesson however well it scores.
      if (this.isBlocked(teacherBlocks, requirement.teacherId, day, slot)) {
        return false;
      }
      return true;
    };

    const take = (requirement: Requirement, day: string, slot: number) => {
      const cell = key(day, slot);
      if (!state.classBusy.has(requirement.classId)) {
        state.classBusy.set(requirement.classId, new Set());
      }
      state.classBusy.get(requirement.classId).add(cell);

      if (requirement.teacherId) {
        if (!state.teacherBusy.has(requirement.teacherId)) {
          state.teacherBusy.set(requirement.teacherId, new Set());
        }
        state.teacherBusy.get(requirement.teacherId).add(cell);
      }

      const dk = dayKey(requirement, day);
      state.subjectPerDay.set(dk, (state.subjectPerDay.get(dk) ?? 0) + 1);
    };

    const release = (requirement: Requirement, day: string, slot: number) => {
      const cell = key(day, slot);
      state.classBusy.get(requirement.classId)?.delete(cell);
      if (requirement.teacherId) {
        state.teacherBusy.get(requirement.teacherId)?.delete(cell);
      }
      const dk = dayKey(requirement, day);
      state.subjectPerDay.set(dk, (state.subjectPerDay.get(dk) ?? 1) - 1);
    };

    /**
     * Lower is better. These are preferences, not rules — a slot that breaks
     * every one of them is still returned rather than failing the run.
     */
    const penalty = (requirement: Requirement, day: string, slot: number) => {
      let score = 0;

      // Six maths periods all on Sunday is a technically valid timetable and a
      // useless one.
      const sameToday = state.subjectPerDay.get(dayKey(requirement, day)) ?? 0;
      if (sameToday >= maxSamePerDay) score += 1000 * (sameToday - maxSamePerDay + 1);

      // Keep a teacher's day contiguous: a free period between two lessons is
      // time they spend waiting at school.
      if (requirement.teacherId) {
        const busy = state.teacherBusy.get(requirement.teacherId);
        if (busy?.size) {
          const before = busy.has(key(day, slot - 1));
          const after = busy.has(key(day, slot + 1));
          if (!before && !after) score += 12;
        }
      }

      // Fill from the top of the day down. A subject marked 'early' feels this
      // pull three times as hard, which is what puts core subjects ahead of
      // the rest when they compete for the same morning slot; 'late' inverts
      // it so art and PE drift toward the end of the day.
      const preference = requirement.slotPreference ?? 'any';
      if (preference === 'early') score += slot * 3;
      else if (preference === 'late') {
        score += ((capacity.periodsByDay[day] ?? capacity.periodsPerDay) - slot) * 3;
      }
      else score += slot;

      return score;
    };

    const place = (index: number): boolean => {
      if (index >= units.length) return true;
      if (budget-- <= 0) return false;

      const requirement = units[index];

      const candidates = slots
        .filter((s) => isFree(requirement, s.day, s.slot))
        .map((s) => ({ ...s, score: penalty(requirement, s.day, s.slot) }))
        .sort(
          (a, b) =>
            a.score - b.score ||
            capacity.workingDays.indexOf(a.day) - capacity.workingDays.indexOf(b.day) ||
            a.slot - b.slot,
        );

      if (candidates.length === 0) {
        unplaced.push(requirement);
        // Carry on rather than abandoning the run: one impossible subject
        // should not cost the school the other 300 periods that do fit.
        return place(index + 1);
      }

      // Only the most promising few are worth revisiting; trying all 35 at
      // every level is what turns this exponential.
      for (const candidate of candidates.slice(0, 6)) {
        take(requirement, candidate.day, candidate.slot);
        placements.push({
          classId: requirement.classId,
          className: requirement.className,
          subjectOfferingId: requirement.subjectOfferingId,
          subjectName: requirement.subjectName,
          teacherId: requirement.teacherId,
          teacherName: requirement.teacherName,
          dayOfWeek: candidate.day,
          slot: candidate.slot,
        });

        if (place(index + 1)) return true;

        placements.pop();
        release(requirement, candidate.day, candidate.slot);
      }

      return false;
    };

    const completed = place(0);

    if (!completed && unplaced.length === 0) {
      problems.push({
        type: 'search_exhausted',
        message:
          'The search ran out of steps before placing everything. The plan is probably too tight to fit — check /lectures/feasibility.',
        blocking: false,
      });
    }

    for (const requirement of unplaced) {
      problems.push({
        type: 'no_slot_left',
        message: requirement.teacherName
          ? `${requirement.className} — ${requirement.subjectName}: ${requirement.teacherName} is busy in every slot this class still has free.`
          : `${requirement.className} — ${requirement.subjectName}: no free slot left in the week.`,
        blocking: false,
        classId: requirement.classId,
        className: requirement.className,
        subjectName: requirement.subjectName,
        teacherName: requirement.teacherName,
      });
    }

    if (skipped.length > 0) {
      problems.push({
        type: 'nothing_planned',
        message: `${skipped.length} classes already have a timetable and were left alone. Use onExisting: "replace" to rebuild them.`,
        blocking: false,
        skippedClasses: skipped.length,
      });
    }

    const grid = this.toGrid(placements, capacity);

    if (mode !== 'commit') {
      return {
        mode: 'preview',
        termId: dto.termId,
        ...capacity,
        placed: placements.length,
        unplaced: unplaced.length,
        skippedClasses: skipped.length,
        classes: grid,
        problems,
        written: false,
      };
    }

    // ---------------------------------------------------------------- commit
    const touchedClasses = [...new Set(placements.map((p) => p.classId))].map(
      (id) => new mongoose.Types.ObjectId(id),
    );

    let deleted = 0;
    if (onExisting === 'replace' && touchedClasses.length > 0) {
      const result = await this.lectureModel.deleteMany({
        termId: termObjectId,
        classId: { $in: touchedClasses },
      });
      deleted = result.deletedCount ?? 0;
    }

    let written = 0;
    const failures: any[] = [];

    // One at a time, not insertMany: an ordered insertMany stops at the first
    // rejection and an unordered one hides which rows failed. Here a conflict
    // costs one period, and the report says which.
    for (const placement of placements) {
      try {
        await this.lectureModel.create({
          classId: new mongoose.Types.ObjectId(placement.classId),
          subjectOfferingId: new mongoose.Types.ObjectId(placement.subjectOfferingId),
          termId: termObjectId,
          teacherId: placement.teacherId
            ? new mongoose.Types.ObjectId(placement.teacherId)
            : null,
          dayOfWeek: placement.dayOfWeek,
          slot: placement.slot,
          preparation: [],
        });
        written++;
      } catch (error: any) {
        failures.push({
          className: placement.className,
          subjectName: placement.subjectName,
          dayOfWeek: placement.dayOfWeek,
          slot: placement.slot,
          reason: error?.code === 11000 ? 'conflict' : (error?.message ?? 'unknown'),
        });
      }
    }

    if (failures.length > 0) {
      problems.push({
        type: 'no_slot_left',
        message: `${failures.length} lectures were rejected by the database as conflicts. This means something else was written for the same slot between the preview and the commit.`,
        blocking: false,
        failures: failures.slice(0, 20),
      });
    }

    return {
      mode: 'commit',
      termId: dto.termId,
      ...capacity,
      placed: placements.length,
      written,
      failed: failures.length,
      deleted,
      unplaced: unplaced.length,
      skippedClasses: skipped.length,
      classes: grid,
      problems,
    };
  }

  /** Reshapes a flat placement list into one grid per class, for rendering. */
  private toGrid(
    placements: Placement[],
    capacity: {
      workingDays: string[];
      periodsPerDay: number;
      periodsByDay?: Record<string, number>;
    },
  ) {
    const byClass = new Map<string, Placement[]>();
    for (const placement of placements) {
      if (!byClass.has(placement.classId)) byClass.set(placement.classId, []);
      byClass.get(placement.classId).push(placement);
    }

    return [...byClass.entries()]
      .map(([classId, rows]) => ({
        classId,
        className: rows[0].className,
        periods: rows.length,
        days: capacity.workingDays.map((day) => ({
          dayOfWeek: day,
          // Render this day's real length. Padding a six-period day out to
          // eight would show two empty periods that do not exist.
          slots: Array.from(
            { length: capacity.periodsByDay?.[day] ?? capacity.periodsPerDay },
            (_, i) => {
            const slot = i + 1;
            const hit = rows.find((r) => r.dayOfWeek === day && r.slot === slot);
            return hit
              ? {
                  slot,
                  subjectOfferingId: hit.subjectOfferingId,
                  subjectName: hit.subjectName,
                  teacherId: hit.teacherId,
                  teacherName: hit.teacherName,
                }
                : { slot, subjectOfferingId: null, subjectName: null, teacherId: null, teacherName: null };
            },
          ),
        })),
      }))
      .sort((a, b) => a.className.localeCompare(b.className, 'ar'));
  }
}
