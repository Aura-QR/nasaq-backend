import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { LeaveRequest } from './schemas/leave-request.schema';
import { DutySupervisor } from './schemas/duty-supervisor.schema';
import { Substitution } from './schemas/substitution.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { TeacherAttendance } from '../teacher-attendance/schemas/teacher-attendance.schema';
import { Term } from '../terms/schemas/term.schema';
import {
  CreateLeaveRequestDto,
  ReviewLeaveRequestDto,
} from './dto/leave-request.dto';
import { SetDutySupervisorsDto } from './dto/duty-supervisor.dto';
import { CreateSubstitutionDto } from './dto/substitution.dto';

const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

/**
 * A calendar day, not an instant. A lesson on the 2nd is on the 2nd in every
 * timezone, so days are anchored at UTC midnight and never shifted.
 */
function dayStart(value: string | Date): Date {
  const raw = typeof value === 'string' ? value.trim() : value;
  const parsed =
    typeof raw === 'string'
      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw)
      : raw;

  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`تاريخ غير صالح: "${value}"`);
  }

  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

function toDateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

@Injectable()
export class DutyService {
  constructor(
    @InjectModel(LeaveRequest.name)
    private readonly leaveModel: Model<LeaveRequest>,
    @InjectModel(DutySupervisor.name)
    private readonly supervisorModel: Model<DutySupervisor>,
    @InjectModel(Substitution.name)
    private readonly substitutionModel: Model<Substitution>,
    @InjectModel(Teacher.name) private readonly teacherModel: Model<Teacher>,
    @InjectModel(Lecture.name) private readonly lectureModel: Model<Lecture>,
    @InjectModel(TeacherAttendance.name)
    private readonly attendanceModel: Model<TeacherAttendance>,
    @InjectModel(Term.name) private readonly termModel: Model<Term>,
  ) {}

  // ───────────────────────────────────────────────── leave requests

  async createLeaveRequest(dto: CreateLeaveRequestDto, user: any) {
    // A teacher always files for themselves; only staff may file on behalf.
    const teacherId =
      user?.role === 'TEACHER' ? String(user.userId) : (dto.teacherId ?? null);

    if (!teacherId) {
      throw new BadRequestException('teacherId مطلوب لما الطلب يتعمل نيابة عن مدرس');
    }

    const teacher = await this.teacherModel.findById(teacherId).lean().exec();
    if (!teacher) {
      throw new NotFoundException(`المدرس ${teacherId} غير موجود`);
    }

    const date = dayStart(dto.date);

    const existing = await this.leaveModel.findOne({ teacherId, date }).exec();
    if (existing) {
      if (existing.status !== 'pending') {
        throw new BadRequestException(
          `فيه استئذان لليوم ده تمت مراجعته بالفعل (${existing.status}).`,
        );
      }
      // A second request for the same day is an edit of the first, not a
      // separate ask — the day has one answer.
      existing.leaveAt = dto.leaveAt;
      existing.fromSlot = dto.fromSlot ?? null;
      existing.reason = dto.reason ?? '';
      await existing.save();
      return { message: 'تم تحديث طلب الاستئذان', data: existing };
    }

    const created = await new this.leaveModel({
      teacherId,
      teacherName: (teacher as any).name ?? '',
      date,
      leaveAt: dto.leaveAt,
      fromSlot: dto.fromSlot ?? null,
      reason: dto.reason ?? '',
      status: 'pending',
    }).save();

    return { message: 'تم إرسال طلب الاستئذان', data: created };
  }

  async listLeaveRequests(filters: {
    date?: string;
    from?: string;
    to?: string;
    status?: string;
    teacherId?: string;
  }, user: any) {
    const query: any = {};

    if (filters.date) {
      query.date = dayStart(filters.date);
    } else if (filters.from || filters.to) {
      query.date = {};
      if (filters.from) query.date.$gte = dayStart(filters.from);
      if (filters.to) query.date.$lte = dayStart(filters.to);
    }

    if (filters.status) query.status = filters.status;

    // A teacher only ever sees their own, whatever they ask for.
    if (user?.role === 'TEACHER') {
      query.teacherId = user.userId;
    } else if (filters.teacherId) {
      query.teacherId = filters.teacherId;
    }

    const rows = await this.leaveModel
      .find(query)
      .sort({ date: -1, createdAt: -1 })
      .lean()
      .exec();

    return rows.map((row: any) => ({ ...row, date: toDateOnly(row.date) }));
  }

  async reviewLeaveRequest(id: string, dto: ReviewLeaveRequestDto, user: any) {
    if (user?.role === 'TEACHER') {
      throw new ForbiddenException('المدرس لا يراجع استئذانه بنفسه');
    }

    const request = await this.leaveModel.findById(id).exec();
    if (!request) {
      throw new NotFoundException(`طلب الاستئذان ${id} غير موجود`);
    }

    request.status = dto.status;
    request.reviewNote = dto.reviewNote ?? '';
    request.reviewedBy = user?.userId ?? null;
    request.reviewedByName = user?.name ?? user?.email ?? '';
    request.reviewedAt = new Date();
    await request.save();

    return {
      message:
        dto.status === 'approved'
          ? 'تمت الموافقة على الاستئذان'
          : dto.status === 'rejected'
            ? 'تم رفض الاستئذان'
            : 'تم إرجاع الطلب للمراجعة',
      data: request,
    };
  }

  async cancelLeaveRequest(id: string, user: any) {
    const request = await this.leaveModel.findById(id).exec();
    if (!request) {
      throw new NotFoundException(`طلب الاستئذان ${id} غير موجود`);
    }

    if (user?.role === 'TEACHER') {
      if (String(request.teacherId) !== String(user.userId)) {
        throw new ForbiddenException('ليس مسموحاً لك بإلغاء استئذان مدرس تاني');
      }
      if (request.status !== 'pending') {
        throw new BadRequestException(
          'الطلب تمت مراجعته بالفعل — كلّم الإدارة لتعديله.',
        );
      }
    }

    await this.leaveModel.findByIdAndDelete(id).exec();
    return { message: 'تم إلغاء طلب الاستئذان', data: request };
  }

  /**
   * Is this teacher excused from part of this day?
   *
   * Used by the attendance module so a sanctioned departure is not recorded as
   * leaving early. Returns null when there is no approved request.
   */
  async findApprovedLeave(teacherId: any, date: Date) {
    return this.leaveModel
      .findOne({ teacherId, date: dayStart(date), status: 'approved' })
      .lean()
      .exec();
  }

  // ─────────────────────────────────────────────── duty supervisors

  async setSupervisors(dto: SetDutySupervisorsDto, user: any) {
    const date = dayStart(dto.date);
    const ids = [...new Set(dto.teacherIds.map(String))];

    const teachers = await this.teacherModel
      .find({ _id: { $in: ids } })
      .select('name')
      .lean()
      .exec();

    const missing = ids.filter(
      (id) => !teachers.some((t: any) => String(t._id) === id),
    );
    if (missing.length > 0) {
      throw new NotFoundException(`مدرسون غير موجودين: ${missing.join(', ')}`);
    }

    // Names are stored in the same order as the ids so a roster reads back
    // exactly as it was set.
    const byId = new Map(teachers.map((t: any) => [String(t._id), t.name]));

    const saved = await this.supervisorModel
      .findOneAndUpdate(
        { date },
        {
          date,
          teacherIds: ids.map((id) => new mongoose.Types.ObjectId(id)),
          teacherNames: ids.map((id) => byId.get(id) ?? ''),
          notes: dto.notes ?? '',
          setBy: user?.userId ?? null,
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    return {
      message: ids.length === 0 ? 'تم مسح مناوبة اليوم' : 'تم حفظ مناوبة اليوم',
      data: { ...saved.toObject(), date: toDateOnly(saved.date) },
    };
  }

  async getSupervisors(filters: { date?: string; from?: string; to?: string }) {
    const query: any = {};

    if (filters.date) {
      query.date = dayStart(filters.date);
    } else if (filters.from || filters.to) {
      query.date = {};
      if (filters.from) query.date.$gte = dayStart(filters.from);
      if (filters.to) query.date.$lte = dayStart(filters.to);
    } else {
      query.date = dayStart(new Date());
    }

    const rows = await this.supervisorModel
      .find(query)
      .sort({ date: 1 })
      .lean()
      .exec();

    return rows.map((row: any) => ({ ...row, date: toDateOnly(row.date) }));
  }

  // ────────────────────────────────────────────────── substitutions

  async createSubstitution(dto: CreateSubstitutionDto, user: any) {
    const date = dayStart(dto.date);

    const lecture: any = await this.lectureModel
      .findById(dto.lectureId)
      .lean()
      .exec();
    if (!lecture) {
      throw new NotFoundException(`الحصة ${dto.lectureId} غير موجودة`);
    }

    // The cover must actually fall on the day being covered, or it silently
    // never applies.
    const weekday = WEEKDAY_NAMES[date.getUTCDay()];
    if (lecture.dayOfWeek !== weekday) {
      throw new BadRequestException(
        `الحصة دي بتاعة يوم ${lecture.dayOfWeek}، والتاريخ المختار ${weekday}.`,
      );
    }

    const substitute: any = await this.teacherModel
      .findById(dto.substituteTeacherId)
      .select('name')
      .lean()
      .exec();
    if (!substitute) {
      throw new NotFoundException(
        `المدرس البديل ${dto.substituteTeacherId} غير موجود`,
      );
    }

    if (
      lecture.teacherId &&
      String(lecture.teacherId) === String(dto.substituteTeacherId)
    ) {
      throw new BadRequestException(
        'المدرس البديل هو نفسه مدرس الحصة الأصلي.',
      );
    }

    const conflicts = await this.findSubstituteConflicts(
      date,
      dto.substituteTeacherId,
      lecture,
    );
    if (conflicts.length > 0) {
      throw new BadRequestException(
        `${substitute.name} مشغول في نفس الوقت: ${conflicts.join('، ')}`,
      );
    }

    const absentTeacher: any = lecture.teacherId
      ? await this.teacherModel
          .findById(lecture.teacherId)
          .select('name')
          .lean()
          .exec()
      : null;

    const saved = await this.substitutionModel
      .findOneAndUpdate(
        { date, lectureId: lecture._id },
        {
          date,
          lectureId: lecture._id,
          absentTeacherId: lecture.teacherId ?? null,
          absentTeacherName: absentTeacher?.name ?? '',
          substituteTeacherId: new mongoose.Types.ObjectId(
            dto.substituteTeacherId,
          ),
          substituteTeacherName: substitute.name ?? '',
          reason: dto.reason ?? 'absent',
          notes: dto.notes ?? '',
          createdBy: user?.userId ?? null,
        },
        { new: true, upsert: true, setDefaultsOnInsert: true },
      )
      .exec();

    return {
      message: `تم تكليف ${substitute.name} بالحصة`,
      data: { ...saved.toObject(), date: toDateOnly(saved.date) },
    };
  }

  /**
   * Everything already claiming this teacher at this hour: their own lecture
   * in the slot, and any cover they have already been given.
   */
  private async findSubstituteConflicts(
    date: Date,
    substituteTeacherId: string,
    lecture: any,
  ): Promise<string[]> {
    const reasons: string[] = [];

    const ownLecture = await this.lectureModel
      .findOne({
        teacherId: substituteTeacherId,
        dayOfWeek: lecture.dayOfWeek,
        slot: lecture.slot,
        termId: lecture.termId,
      })
      .lean()
      .exec();
    if (ownLecture) reasons.push('عنده حصة في نفس الخانة');

    const otherCover = await this.substitutionModel
      .findOne({
        date,
        substituteTeacherId,
        lectureId: { $ne: lecture._id },
      })
      .lean()
      .exec();

    if (otherCover) {
      const covered: any = await this.lectureModel
        .findById((otherCover as any).lectureId)
        .lean()
        .exec();
      if (covered?.slot === lecture.slot) {
        reasons.push('مكلّف باحتياطي تاني في نفس الخانة');
      }
    }

    return reasons;
  }

  async removeSubstitution(id: string) {
    const removed = await this.substitutionModel.findByIdAndDelete(id).exec();
    if (!removed) {
      throw new NotFoundException(`التكليف ${id} غير موجود`);
    }
    return { message: 'تم إلغاء التكليف', data: removed };
  }

  async listSubstitutions(filters: { date?: string; teacherId?: string }, user: any) {
    const query: any = { date: dayStart(filters.date ?? new Date()) };

    if (user?.role === 'TEACHER') {
      query.substituteTeacherId = user.userId;
    } else if (filters.teacherId) {
      query.substituteTeacherId = filters.teacherId;
    }

    const rows = await this.substitutionModel
      .find(query)
      .populate({
        path: 'lectureId',
        populate: [
          { path: 'classId', select: 'name roomNumber' },
          { path: 'subjectOfferingId', populate: { path: 'subjectId' } },
        ],
      })
      .lean()
      .exec();

    return rows.map((row: any) => ({ ...row, date: toDateOnly(row.date) }));
  }

  // ───────────────────────────────────────────────── the cover board

  /**
   * Everything that needs covering today, and who could take it.
   *
   * Picking a substitute by hand means holding the whole timetable in your
   * head: who is off, which of their lectures fall today, and which of the
   * remaining teachers is free in that exact slot. This answers all three, and
   * the suggestions are what turns a twenty-minute puzzle into a tap.
   *
   * A teacher is offered as a substitute only if they are at school today, are
   * not the absent teacher, have no lecture of their own in that slot, and are
   * not already covering something else in it.
   */
  async getCoverage(dateStr: string | undefined, user: any) {
    const date = dayStart(dateStr ?? new Date());
    const weekday = WEEKDAY_NAMES[date.getUTCDay()];

    const term: any = await this.termModel
      .findOne({ status: 'active' })
      .lean()
      .exec();

    const [teachers, attendance, leaves, existingCover]: any[] =
      await Promise.all([
        this.teacherModel.find({ isActive: { $ne: false } })
          .select('name specialization').lean().exec(),
        this.attendanceModel.find({ date }).select('teacherId').lean().exec(),
        this.leaveModel.find({ date, status: 'approved' }).lean().exec(),
        this.substitutionModel.find({ date }).lean().exec(),
      ]);

    const presentIds = new Set<string>(
      attendance.map((a: any) => String(a.teacherId)),
    );
    const leaveByTeacher = new Map<string, any>(
      leaves.map((l: any) => [String(l.teacherId), l]),
    );

    // Absent = did not check in. On a day nobody has checked in yet — early
    // morning, or a school not using check-in — that would flag the entire
    // staff, which is noise rather than information.
    const checkInInUse = attendance.length > 0;
    const absentIds = checkInInUse
      ? teachers
          .map((t: any) => String(t._id))
          .filter((id: string) => !presentIds.has(id))
      : [];

    const needsCoverFrom = new Set<string>([
      ...(absentIds as string[]),
      ...leaveByTeacher.keys(),
    ]);

    const lectureFilter: any = { dayOfWeek: weekday };
    if (term) lectureFilter.termId = term._id;

    const lectures: any[] = await this.lectureModel
      .find(lectureFilter)
      .populate('classId', 'name roomNumber')
      .populate({ path: 'subjectOfferingId', populate: { path: 'subjectId' } })
      .lean()
      .exec();

    const teacherById = new Map<string, any>(
      teachers.map((t: any) => [String(t._id), t]),
    );
    const coverByLecture = new Map<string, any>(
      existingCover.map((c: any) => [String(c.lectureId), c]),
    );

    // Who is busy in which slot, counting cover already assigned.
    const busyBySlot = new Map<number, Set<string>>();
    for (const lecture of lectures) {
      if (!lecture.teacherId) continue;
      if (!busyBySlot.has(lecture.slot)) busyBySlot.set(lecture.slot, new Set());
      busyBySlot.get(lecture.slot).add(String(lecture.teacherId));
    }
    for (const cover of existingCover) {
      const lecture = lectures.find(
        (l) => String(l._id) === String(cover.lectureId),
      );
      if (!lecture) continue;
      if (!busyBySlot.has(lecture.slot)) busyBySlot.set(lecture.slot, new Set());
      busyBySlot.get(lecture.slot).add(String(cover.substituteTeacherId));
    }

    const uncovered: any[] = [];
    const covered: any[] = [];

    for (const lecture of lectures) {
      const ownerId = lecture.teacherId ? String(lecture.teacherId) : null;
      const leave = ownerId ? leaveByTeacher.get(ownerId) : null;

      // An approved leave from the fourth period does not touch the first
      // three. Without fromSlot the whole day is offered and the manager
      // decides — the school has no per-slot clock to convert a time from.
      const leaveApplies =
        leave != null &&
        (leave.fromSlot == null || lecture.slot >= leave.fromSlot);

      const isAbsent = ownerId != null && absentIds.includes(ownerId);
      if (!isAbsent && !leaveApplies) continue;

      const existing = coverByLecture.get(String(lecture._id));
      const entry = {
        lectureId: String(lecture._id),
        slot: lecture.slot,
        dayOfWeek: lecture.dayOfWeek,
        className: lecture.classId?.name ?? null,
        roomNumber: lecture.classId?.roomNumber ?? null,
        subjectName:
          lecture.subjectOfferingId?.subjectId?.subjectName ?? null,
        subjectId: lecture.subjectOfferingId?.subjectId?._id
          ? String(lecture.subjectOfferingId.subjectId._id)
          : null,
        absentTeacherId: ownerId,
        absentTeacherName: ownerId
          ? (teacherById.get(ownerId)?.name ?? null)
          : null,
        reason: isAbsent ? 'absent' : 'leave',
        leaveAt: leaveApplies ? leave.leaveAt : null,
      };

      if (existing) {
        covered.push({
          ...entry,
          substitutionId: String(existing._id),
          substituteTeacherId: String(existing.substituteTeacherId),
          substituteTeacherName: existing.substituteTeacherName,
        });
      } else {
        uncovered.push({
          ...entry,
          suggestions: this.suggestSubstitutes({
            teachers,
            busyBySlot,
            slot: lecture.slot,
            excludeId: ownerId,
            needsCoverFrom,
            presentIds,
            checkInInUse,
            subjectName: entry.subjectName,
          }),
        });
      }
    }

    uncovered.sort((a, b) => a.slot - b.slot);
    covered.sort((a, b) => a.slot - b.slot);

    const supervisors = await this.supervisorModel.findOne({ date }).lean().exec();

    return {
      date: toDateOnly(date),
      dayOfWeek: weekday,
      termId: term ? String(term._id) : null,
      checkInInUse,
      absentTeachers: absentIds.map((id: string) => ({
        teacherId: id,
        name: teacherById.get(id)?.name ?? null,
      })),
      onLeave: [...leaveByTeacher.values()].map((l: any) => ({
        teacherId: String(l.teacherId),
        name: l.teacherName,
        leaveAt: l.leaveAt,
        fromSlot: l.fromSlot,
      })),
      supervisors: supervisors
        ? {
            teacherIds: (supervisors as any).teacherIds.map(String),
            teacherNames: (supervisors as any).teacherNames,
            notes: (supervisors as any).notes,
          }
        : null,
      stats: {
        needCover: uncovered.length + covered.length,
        covered: covered.length,
        uncovered: uncovered.length,
      },
      uncovered,
      covered,
    };
  }

  /** Free teachers for one slot, best fit first. */
  private suggestSubstitutes(input: {
    teachers: any[];
    busyBySlot: Map<number, Set<string>>;
    slot: number;
    excludeId: string | null;
    needsCoverFrom: Set<string>;
    presentIds: Set<string>;
    checkInInUse: boolean;
    subjectName: string | null;
  }) {
    const busy = input.busyBySlot.get(input.slot) ?? new Set<string>();

    return input.teachers
      .filter((teacher: any) => {
        const id = String(teacher._id);
        if (id === input.excludeId) return false;
        // Somebody off today cannot cover for somebody else off today.
        if (input.needsCoverFrom.has(id)) return false;
        if (input.checkInInUse && !input.presentIds.has(id)) return false;
        return !busy.has(id);
      })
      .map((teacher: any) => {
        // A specialist in the subject is a real cover; anyone else is
        // supervision. Both are offered, the better one first.
        const specialised =
          input.subjectName != null &&
          typeof teacher.specialization === 'string' &&
          teacher.specialization.trim() !== '' &&
          (teacher.specialization.includes(input.subjectName) ||
            input.subjectName.includes(teacher.specialization));

        return {
          teacherId: String(teacher._id),
          name: teacher.name,
          specialization: teacher.specialization ?? null,
          sameSubject: specialised,
        };
      })
      .sort((a, b) => {
        if (a.sameSubject !== b.sameSubject) return a.sameSubject ? -1 : 1;
        return String(a.name).localeCompare(String(b.name), 'ar');
      });
  }
}
