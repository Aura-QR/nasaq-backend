import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Preparation } from './schemas/preparation.schema';
import { PreparationResource } from './schemas/preparation-resource.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { SubjectOffering } from '../subject-offerings/schemas/subject-offering.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { dayKey, nextLessonDate } from './homework-due';
import { lessonDateFor, parseDateOnly } from './utils/week.util';

/** Preparations a student may see; the same rule as the lesson page. */
const VISIBLE_TO_STUDENTS = ['pending', 'approved'];

/** How far back «واجباتي» reaches. A term, roughly; older homework is history. */
const STUDENT_WINDOW_DAYS = 120;

const id = (value: any): string => String(value?._id ?? value ?? '');

/**
 * Homework written on a lesson, joined up with the student and the sheet.
 *
 * Homework lives on a preparation as a resource of type `homework`. Before
 * this it reached the student only inside that one lesson's page — «واجباتي»
 * listed electronic assignments (exams of type `assignment`) and nothing
 * else — and the daily-tracking sheet ticked «واجب» without saying which.
 * This is the one place that answers both: what homework a student has, and
 * what homework is due in a given period.
 */
@Injectable()
export class HomeworkService {
  constructor(
    @InjectModel(Preparation.name) private readonly preparations: Model<Preparation>,
    @InjectModel(PreparationResource.name) private readonly resources: Model<PreparationResource>,
    @InjectModel(Lecture.name) private readonly lectures: Model<Lecture>,
    @InjectModel(SubjectOffering.name) private readonly offerings: Model<SubjectOffering>,
    @InjectModel(Teacher.name) private readonly teachers: Model<Teacher>,
  ) {}

  /** When homework set on this preparation is due: the class's next lesson in the subject. */
  async dueDateFor(prep: any): Promise<Date | null> {
    return (await this.dueDates([prep])).get(id(prep)) ?? null;
  }

  /**
   * The timetable slot a preparation was written for.
   *
   * Usually the live lecture. A lecture removed from the timetable after the
   * preparation was written survives only as the snapshot the preparation
   * keeps in `lecture`, and that snapshot still says which class, subject,
   * day and period it was.
   */
  private slotFrom(prep: any, live: Map<string, any>): any | null {
    const found = live.get(id(prep.lecture));
    if (found) return found;
    const snap = prep.lecture;
    return snap && typeof snap === 'object' && snap.dayOfWeek && snap.classId && snap.subjectOfferingId ? snap : null;
  }

  /**
   * Due dates for many preparations at once, for homework saved before due
   * dates were set. Grouped by class and subject so a page of fifty lessons
   * costs one timetable read per subject rather than one per lesson.
   */
  private async dueDates(preps: any[]): Promise<Map<string, Date | null>> {
    const out = new Map<string, Date | null>();
    const lectureIds = [...new Set(preps.map((p) => id(p.lecture)).filter((v) => Types.ObjectId.isValid(v)))];
    const live: any[] = lectureIds.length
      ? await this.lectures.find({ _id: { $in: lectureIds } }).select('classId subjectOfferingId termId dayOfWeek slot').lean()
      : [];
    const byId = new Map(live.map((l) => [id(l), l]));
    const groupKey = (l: any) => `${id(l.classId)}|${id(l.subjectOfferingId)}|${id(l.termId)}`;
    const groups = new Map<string, any[]>();
    const siblingsOf = async (l: any) => {
      const key = groupKey(l);
      if (!groups.has(key)) {
        const same = { classId: id(l.classId), subjectOfferingId: id(l.subjectOfferingId) };
        let rows: any[] = await this.lectures.find({ ...same, ...(l.termId ? { termId: id(l.termId) } : {}) }).select('dayOfWeek slot').lean();
        // The term the slot belonged to may be over; the class's timetable now is the next best answer.
        if (!rows.length && l.termId) rows = await this.lectures.find(same).select('dayOfWeek slot').lean();
        groups.set(key, rows);
      }
      return groups.get(key) ?? [];
    };
    for (const p of preps) {
      const slot = this.slotFrom(p, byId);
      out.set(id(p._id), slot ? nextLessonDate(p.weekOf, slot, await siblingsOf(slot)) : null);
    }
    return out;
  }

  /** Subject name per offering id, for labels. */
  private async subjectNames(offeringIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(offeringIds)].filter((v) => Types.ObjectId.isValid(v));
    if (!ids.length) return new Map();
    const rows: any[] = await this.offerings
      .find({ _id: { $in: ids } })
      .select('subjectId')
      .populate('subjectId', 'subjectName')
      .lean();
    return new Map(rows.map((o) => [id(o), o.subjectId?.subjectName ?? '']));
  }

  /**
   * Every lesson homework this student has, newest lesson first.
   *
   * `classFilter` is the student's own class scope, from the same rule the
   * lesson page uses, so this lists exactly the homework the student could
   * already reach by opening each lesson — no more.
   */
  async forStudent(classFilter: Record<string, any>) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - STUDENT_WINDOW_DAYS);
    const preps: any[] = await this.preparations
      .find({ ...classFilter, reviewStatus: { $in: VISIBLE_TO_STUDENTS }, weekOf: { $gte: since } })
      .select('_id lessonTitle subject weekOf lecture submittedBy')
      .lean();
    if (!preps.length) return [];

    const rows: any[] = await this.resources
      .find({ preparationId: { $in: preps.map((p) => p._id) }, type: 'homework' })
      .sort({ createdAt: -1 })
      .lean();
    if (!rows.length) return [];

    const prepById = new Map(preps.map((p) => [id(p), p]));
    const withHomework = [...new Set(rows.map((r) => id(r.preparationId)))].map((pid) => prepById.get(pid)).filter(Boolean);
    const [names, computed, teachers, lectures] = await Promise.all([
      this.subjectNames(withHomework.map((p) => id(p.subject))),
      this.dueDates(withHomework.filter((p) => rows.some((r) => id(r.preparationId) === id(p) && !r.dueAt))),
      this.teachers.find({ _id: { $in: withHomework.map((p) => p.submittedBy).filter(Boolean) } }).select('name').lean(),
      this.lectures.find({ _id: { $in: withHomework.map((p) => id(p.lecture)).filter((v) => Types.ObjectId.isValid(v)) } })
        .select('dayOfWeek').lean(),
    ]);
    const teacherName = new Map((teachers as any[]).map((t) => [id(t), t.name ?? '']));
    const lectureDay = new Map((lectures as any[]).map((l) => [id(l), l.dayOfWeek]));

    return rows.map((r) => {
      const prep = prepById.get(id(r.preparationId));
      const due = r.dueAt ?? computed.get(id(prep)) ?? null;
      return {
        _id: id(r),
        preparationId: id(prep),
        title: r.title ?? '',
        description: r.description ?? '',
        subjectName: names.get(id(prep.subject)) ?? '',
        teacherName: teacherName.get(id(prep.submittedBy)) ?? '',
        lessonTitle: prep.lessonTitle ?? '',
        assignedOn: dayKey(lessonDateFor(prep.weekOf, lectureDay.get(id(prep.lecture)) ?? prep.lecture?.dayOfWeek)),
        dueAt: dayKey(due),
        totalGrade: r.totalGrade ?? null,
        link: r.link ?? '',
        files: Array.isArray(r.files) ? r.files : [],
      };
    }).sort((a, b) => String(b.dueAt ?? '').localeCompare(String(a.dueAt ?? '')));
  }

  /**
   * Homework due in this class and subject on this day, for the tracking
   * sheet: the teacher ticking «واجب» sees which homework that tick is for.
   *
   * Looks at preparations from the two weeks before the day, which covers a
   * subject that meets once a week; homework without a stored due date is
   * placed on the next lesson after it was set.
   */
  async dueOn(classId: any, offeringId: any, date: string) {
    if (!Types.ObjectId.isValid(id(classId)) || !Types.ObjectId.isValid(id(offeringId))) return [];
    let day: Date;
    try { day = parseDateOnly(date); } catch { return []; }
    const key = dayKey(day);
    const from = new Date(day);
    from.setUTCDate(from.getUTCDate() - 14);

    const preps: any[] = await this.preparations
      .find({ classId: id(classId), subject: { $in: [id(offeringId), new Types.ObjectId(id(offeringId))] }, weekOf: { $gte: from, $lte: day } })
      .select('_id lessonTitle weekOf lecture')
      .lean();
    if (!preps.length) return [];
    const rows: any[] = await this.resources
      .find({ preparationId: { $in: preps.map((p) => p._id) }, type: 'homework' })
      .sort({ createdAt: 1 })
      .lean();
    if (!rows.length) return [];

    const prepById = new Map(preps.map((p) => [id(p), p]));
    const computed = await this.dueDates(
      preps.filter((p) => rows.some((r) => id(r.preparationId) === id(p) && !r.dueAt)),
    );
    return rows
      .filter((r) => dayKey(r.dueAt ?? computed.get(id(r.preparationId))) === key)
      .map((r) => ({
        _id: id(r),
        preparationId: id(r.preparationId),
        title: r.title ?? '',
        description: r.description ?? '',
        lessonTitle: prepById.get(id(r.preparationId))?.lessonTitle ?? '',
      }));
  }
}
