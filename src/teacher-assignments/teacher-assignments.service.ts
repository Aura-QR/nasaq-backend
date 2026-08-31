import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { TeacherAssignment } from './schemas/teacher-assignment.schema';
import { CreateTeacherAssignmentDto } from './dto/create-teacher-assignment.dto';
import { ImportAssignmentsDto } from './dto/import-assignments.dto';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { GradeLevel } from '../grade-levels/schemas/grade-level.schema';
import { SubjectOffering } from '../subject-offerings/schemas/subject-offering.schema';
import { matchByName, parseRows } from '../common/arabic-name.util';

@Injectable()
export class TeacherAssignmentsService {
  constructor(
    @InjectModel(TeacherAssignment.name)
    private readonly teacherAssignmentModel: Model<TeacherAssignment>,
    @InjectModel(Teacher.name)
    private readonly teacherModel: Model<Teacher>,
    @InjectModel(Subject.name)
    private readonly subjectModel: Model<Subject>,
    @InjectModel(GradeLevel.name)
    private readonly gradeLevelModel: Model<GradeLevel>,
    @InjectModel(SubjectOffering.name)
    private readonly subjectOfferingModel: Model<SubjectOffering>,
  ) {}

  /**
   * Reads an assignment sheet pasted out of a spreadsheet.
   *
   * Rows look like `teacher | subject | grade(s)`, which is the shape schools
   * already keep this in. One row may name several grades — "الصف الرابع +
   * الصف الخامس" — because that is how the sheet is actually written.
   *
   * Names are matched after folding honorifics, alef spellings and spacing:
   * the same teacher shows up as "أ/ فاطمة", "أ. فاطمة" and "فاطمة الدهاسي"
   * across three rows of one sheet. A name that matches two people is
   * reported, never guessed — quietly handing a class to the wrong teacher is
   * far harder to notice than an error line.
   *
   * Nothing is written unless `dryRun` is explicitly false.
   */
  async importAssignments(dto: ImportAssignmentsDto) {
    const dryRun = dto.dryRun !== false;
    const termId = new mongoose.Types.ObjectId(dto.termId);

    const [teachers, subjects, gradeLevels, offerings, existing]: any[] =
      await Promise.all([
        this.teacherModel.find().select('name specialization').lean().exec(),
        this.subjectModel.find().select('subjectName').lean().exec(),
        this.gradeLevelModel.find().select('name order').lean().exec(),
        this.subjectOfferingModel.find({ termId }).lean().exec(),
        this.teacherAssignmentModel.find().lean().exec(),
      ]);

    const offeringKey = (subjectId: any, gradeLevelId: any) =>
      `${String(subjectId)}|${String(gradeLevelId)}`;
    const offeringBy = new Map(
      offerings.map((o: any) => [offeringKey(o.subjectId, o.gradeLevelId), o]),
    );

    const alreadyAssigned = new Set(
      existing.map(
        (a: any) =>
          `${String(a.teacherId)}|${String(a.subjectOfferingId)}|${a.classId ? String(a.classId) : 'null'}`,
      ),
    );

    const rows = parseRows(dto.text);
    const results: any[] = [];
    const writes: { teacherId: any; subjectOfferingId: any }[] = [];
    const queued = new Set<string>();

    for (const row of rows) {
      const [rawTeacher, rawSubject, rawGrades] = row.cells;

      if (!rawTeacher || !rawSubject || !rawGrades) {
        results.push({
          line: row.line, raw: row.raw, status: 'error',
          reason: 'Expected three columns: teacher, subject, grade(s).',
        });
        continue;
      }

      const teacherHit = matchByName(rawTeacher, teachers, (t: any) => t.name);
      if (!teacherHit.match) {
        results.push({
          line: row.line, raw: row.raw, status: 'error',
          reason: teacherHit.ambiguous.length > 0
            ? `"${rawTeacher}" matches ${teacherHit.ambiguous.length} teachers: ${teacherHit.ambiguous.map((t: any) => t.name).join(', ')}. Use the full name.`
            : `No teacher named "${rawTeacher}".`,
        });
        continue;
      }

      const subjectHit = matchByName(rawSubject, subjects, (s: any) => s.subjectName);
      if (!subjectHit.match) {
        results.push({
          line: row.line, raw: row.raw, status: 'error',
          reason: subjectHit.ambiguous.length > 0
            ? `"${rawSubject}" matches ${subjectHit.ambiguous.length} subjects.`
            : `No subject named "${rawSubject}".`,
        });
        continue;
      }

      // "الصف الرابع + الصف الخامس" or ".../..." — one row, several grades.
      const gradeNames = rawGrades
        .split(/[+/]/)
        .map((g) => g.trim())
        .filter(Boolean);

      for (const gradeName of gradeNames) {
        const gradeHit = matchByName(gradeName, gradeLevels, (g: any) => g.name);
        if (!gradeHit.match) {
          results.push({
            line: row.line, raw: row.raw, status: 'error',
            reason: gradeHit.ambiguous.length > 0
              ? `"${gradeName}" matches ${gradeHit.ambiguous.length} grade levels.`
              : `No grade level named "${gradeName}".`,
          });
          continue;
        }

        const offering: any = offeringBy.get(
          offeringKey(subjectHit.match._id, gradeHit.match._id),
        );

        if (!offering) {
          results.push({
            line: row.line, raw: row.raw, status: 'error',
            teacherName: teacherHit.match.name,
            reason: `${subjectHit.match.subjectName} is not offered to ${gradeHit.match.name} this term. Add it to the teaching plan first.`,
          });
          continue;
        }

        const key = `${String(teacherHit.match._id)}|${String(offering._id)}|null`;

        if (alreadyAssigned.has(key)) {
          results.push({
            line: row.line, raw: row.raw, status: 'skipped',
            teacherName: teacherHit.match.name,
            subjectName: subjectHit.match.subjectName,
            gradeName: gradeHit.match.name,
            reason: 'Already assigned.',
          });
          continue;
        }

        if (queued.has(key)) {
          results.push({
            line: row.line, raw: row.raw, status: 'skipped',
            teacherName: teacherHit.match.name,
            subjectName: subjectHit.match.subjectName,
            gradeName: gradeHit.match.name,
            reason: 'Repeated earlier in this sheet.',
          });
          continue;
        }

        queued.add(key);
        writes.push({
          teacherId: teacherHit.match._id,
          subjectOfferingId: offering._id,
        });
        results.push({
          line: row.line, raw: row.raw, status: 'assigned',
          teacherId: String(teacherHit.match._id),
          teacherName: teacherHit.match.name,
          subjectName: subjectHit.match.subjectName,
          gradeName: gradeHit.match.name,
          subjectOfferingId: String(offering._id),
          periodsPerWeek: offering.periodsPerWeek ?? 0,
        });
      }
    }

    if (!dryRun) {
      for (const write of writes) {
        await new this.teacherAssignmentModel({
          teacherId: write.teacherId,
          subjectOfferingId: write.subjectOfferingId,
          classId: null,
        }).save();
      }
    }

    const counts = results.reduce(
      (acc: any, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }),
      {},
    );

    return {
      dryRun,
      written: dryRun ? 0 : writes.length,
      totalLines: rows.length,
      assigned: counts.assigned ?? 0,
      skipped: counts.skipped ?? 0,
      errors: counts.error ?? 0,
      results,
    };
  }

  async create(dto: CreateTeacherAssignmentDto) {
    const classId = dto.classId
      ? new mongoose.Types.ObjectId(dto.classId)
      : null;

    const existing = await this.teacherAssignmentModel.findOne({
      teacherId: new mongoose.Types.ObjectId(dto.teacherId),
      subjectOfferingId: new mongoose.Types.ObjectId(dto.subjectOfferingId),
      classId,
    }).exec();

    if (existing) {
      throw new ConflictException(
        classId
          ? 'Teacher is already assigned to this subject offering for this class'
          : 'Teacher is already assigned to this subject offering',
      );
    }

    const assignment = new this.teacherAssignmentModel({
      teacherId: new mongoose.Types.ObjectId(dto.teacherId),
      subjectOfferingId: new mongoose.Types.ObjectId(dto.subjectOfferingId),
      classId,
    });

    return assignment.save();
  }

  /**
   * The whole assignment table for the school, optionally narrowed.
   *
   * findByOffering and findByTeacher both require an id up front, so an admin
   * screen had no way to render the list before choosing something — it had to
   * fetch every teacher and fan out one request each.
   */
  async findAll(
    filters: {
      teacherId?: string;
      subjectOfferingId?: string;
      termId?: string;
      classId?: string;
    } = {},
  ) {
    const query: any = {};
    if (filters.teacherId) {
      query.teacherId = new mongoose.Types.ObjectId(filters.teacherId);
    }
    if (filters.subjectOfferingId) {
      query.subjectOfferingId = new mongoose.Types.ObjectId(filters.subjectOfferingId);
    }
    if (filters.classId) {
      query.classId = new mongoose.Types.ObjectId(filters.classId);
    }

    const rows = await this.teacherAssignmentModel
      .find(query)
      .populate('classId', 'name roomNumber')
      .populate('teacherId', 'name email phoneNumber specialization')
      .populate({
        path: 'subjectOfferingId',
        populate: [
          { path: 'subjectId', select: 'subjectName subjectCode' },
          { path: 'gradeLevelId', select: 'name order' },
          { path: 'termId', select: 'name order status' },
        ],
      })
      .exec();

    // termId lives on the offering, not on the assignment, so it cannot be part
    // of the Mongo query without an aggregation. Filtered here instead.
    if (!filters.termId) return rows;
    return rows.filter((r: any) => {
      const t = r.subjectOfferingId?.termId;
      return String(t?._id ?? t) === String(filters.termId);
    });
  }

  async findByOffering(subjectOfferingId: string) {
    return this.teacherAssignmentModel
      .find({ subjectOfferingId: new mongoose.Types.ObjectId(subjectOfferingId) })
      .populate('classId', 'name roomNumber')
      .populate('teacherId', 'name email phoneNumber')
      .populate('subjectOfferingId')
      .exec();
  }

  async findByTeacher(teacherId: string) {
    return this.teacherAssignmentModel
      .find({ teacherId: new mongoose.Types.ObjectId(teacherId) })
      .populate('classId', 'name roomNumber')
      .populate({
        path: 'subjectOfferingId',
        populate: [
          { path: 'subjectId', select: 'subjectName subjectCode' },
          { path: 'gradeLevelId', select: 'name order' },
          { path: 'termId', select: 'name order status' },
        ],
      })
      .exec();
  }

  async remove(id: string) {
    const deleted = await this.teacherAssignmentModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`Teacher assignment with ID ${id} not found`);
    }
    return deleted;
  }
}
