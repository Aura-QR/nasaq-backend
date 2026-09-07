import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CurriculumUnit } from './schemas/curriculum-unit.schema';
import { CurriculumLesson } from './schemas/curriculum-lesson.schema';
import { Subject } from '../subjects/schemas/subject.schema';
import { GradeLevel } from '../grade-levels/schemas/grade-level.schema';
import { Preparation } from '../preparation/schemas/preparation.schema';
import { CatalogService } from '../catalog/catalog.service';
import {
  CreateCurriculumUnitDto,
  CreateCurriculumLessonDto,
  CreateCurriculumLessonsBulkDto,
  UpdateCurriculumLessonDto,
  UpdateCurriculumUnitDto,
  ImportCurriculumDto,
  CurriculumQueryDto,
} from './dto/curriculum.dto';

@Injectable()
export class CurriculumService {
  constructor(
    @InjectModel(CurriculumUnit.name)
    private readonly units: Model<CurriculumUnit>,
    @InjectModel(CurriculumLesson.name)
    private readonly lessons: Model<CurriculumLesson>,
    @InjectModel(Subject.name) private readonly subjects: Model<Subject>,
    @InjectModel(GradeLevel.name) private readonly grades: Model<GradeLevel>,
    @InjectModel(Preparation.name)
    private readonly preparations: Model<Preparation>,
    private readonly catalog: CatalogService,
  ) {}
  private async validateMapping(subjectId: string, gradeLevelId: string) {
    if (!(await this.subjects.exists({ _id: subjectId })))
      throw new NotFoundException('المادة غير موجودة');
    if (!(await this.grades.exists({ _id: gradeLevelId })))
      throw new NotFoundException('الصف الدراسي غير موجود');
  }
  async import(dto: ImportCurriculumDto) {
    await this.validateMapping(dto.subjectId, dto.gradeLevelId);
    const source = await this.catalog.getUnits(dto.catalogSubjectId);
    let createdUnits = 0,
      createdLessons = 0;
    for (const catalogUnit of source) {
      const key = {
        subjectId: dto.subjectId,
        gradeLevelId: dto.gradeLevelId,
        catalogUnitId: catalogUnit._id,
      };
      let unit = await this.units.findOne(key);
      if (!unit) {
        try {
          unit = await this.units.create({
            ...key,
            name: catalogUnit.name,
            order: catalogUnit.order,
          });
          createdUnits++;
        } catch (err) {
          if (err.code !== 11000) throw err;
          unit = await this.units.findOne(key);
          if (!unit) throw err;
        }
      }
      // Also repairs interrupted imports without overwriting the school's names or objectives.
      for (const catalogLesson of catalogUnit.lessons) {
        const lessonKey = {
          unitId: unit._id,
          catalogLessonId: catalogLesson._id,
        };
        if (await this.lessons.exists(lessonKey)) continue;
        try {
          await this.lessons.create({
            ...lessonKey,
            name: catalogLesson.name,
            order: catalogLesson.order,
            objectives: [],
          });
          createdLessons++;
        } catch (err) {
          if (err.code !== 11000) throw err;
        }
      }
    }
    return { createdUnits, createdLessons };
  }
  async listUnits(query: CurriculumQueryDto) {
    return this.units
      .find({
        ...(query.subjectId ? { subjectId: query.subjectId } : {}),
        ...(query.gradeLevelId ? { gradeLevelId: query.gradeLevelId } : {}),
      })
      .sort({ order: 1, _id: 1 })
      .lean();
  }
  async listLessons(id: string) {
    await this.getUnit(id);
    return this.lessons.find({ unitId: id }).sort({ order: 1, _id: 1 }).lean();
  }
  private async getUnit(id: string) {
    const unit = await this.units.findById(id);
    if (!unit) throw new NotFoundException('الوحدة غير موجودة');
    return unit;
  }
  async createUnit(dto: CreateCurriculumUnitDto) {
    await this.validateMapping(dto.subjectId, dto.gradeLevelId);
    return this.units.create(dto);
  }
  async updateUnit(id: string, dto: UpdateCurriculumUnitDto) {
    await this.getUnit(id);
    return this.units.findByIdAndUpdate(
      id,
      { $set: dto },
      { new: true, runValidators: true },
    );
  }
  async deleteUnit(id: string) {
    await this.getUnit(id);
    if (await this.lessons.exists({ unitId: id }))
      throw new ConflictException('احذف دروس الوحدة أولاً');
    await this.units.findByIdAndDelete(id);
    return { deleted: true };
  }
  async createLesson(unitId: string, dto: CreateCurriculumLessonDto) {
    await this.getUnit(unitId);
    return this.lessons.create({ ...dto, unitId });
  }
  async createLessonsBulk(unitId: string, dto: CreateCurriculumLessonsBulkDto) {
    // listLessons follows the same tenant-scoped unit lookup as createLesson.
    // Besides rejecting a unit from another school, it gives us one snapshot
    // for both duplicate detection and the next order number.
    const existingLessons = await this.listLessons(unitId);
    const existingNames = new Set(existingLessons.map((lesson) => lesson.name));
    const cleanedNames = dto.names
      .map((name) => this.cleanLessonName(name))
      .filter(Boolean);

    let skipped = 0;
    const namesToCreate: string[] = [];
    for (const name of cleanedNames) {
      if (existingNames.has(name)) {
        skipped++;
        continue;
      }
      existingNames.add(name);
      namesToCreate.push(name);
    }

    const currentMaxOrder = existingLessons.reduce(
      (maximum, lesson) => Math.max(maximum, lesson.order),
      -1,
    );

    if (dto.dryRun === true) {
      return {
        message: `تم إنشاء ${namesToCreate.length} دروس`,
        data: {
          created: namesToCreate.length,
          skipped,
          names: cleanedNames,
          lessons: namesToCreate.map((name, index) => ({
            name,
            order: currentMaxOrder + index + 1,
          })),
        },
      };
    }

    const createdLessons = [];
    for (const [index, name] of namesToCreate.entries()) {
      createdLessons.push(
        await this.createLesson(unitId, {
          name,
          order: currentMaxOrder + index + 1,
        }),
      );
    }

    return {
      message: `تم إنشاء ${createdLessons.length} دروس`,
      data: {
        created: createdLessons.length,
        skipped,
        lessons: createdLessons,
      },
    };
  }
  private cleanLessonName(name: string) {
    return name
      .replace(
        /^\s*(?:(?:[0-9\u0660-\u0669]+\s*[.)\-\u2013\u2014:]\s*)|(?:[\-\u2013\u2014\u2022\u25cf\u25aa\u25e6]\s*))/u,
        '',
      )
      .replace(
        /\s*(?:(?:[.\u2024\u2025\u2026\u00b7]\s*){2,})[0-9\u0660-\u0669]+\s*\.?\s*$/u,
        '',
      )
      .trim()
      .replace(/\s+/gu, ' ');
  }
  async updateLesson(id: string, dto: UpdateCurriculumLessonDto) {
    const lesson = await this.lessons.findByIdAndUpdate(
      id,
      { $set: dto },
      { new: true, runValidators: true },
    );
    if (!lesson) throw new NotFoundException('الدرس غير موجود');
    return lesson;
  }
  async deleteLesson(id: string) {
    if (!(await this.lessons.exists({ _id: id })))
      throw new NotFoundException('الدرس غير موجود');
    if (await this.preparations.exists({ lessonId: id }))
      throw new ConflictException('الدرس مرتبط بتحضير ولا يمكن حذفه');
    await this.lessons.findByIdAndDelete(id);
    return { deleted: true };
  }
}
