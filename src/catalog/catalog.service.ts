import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CatalogSubject } from './schemas/catalog-subject.schema';
import { CatalogUnit } from './schemas/catalog-unit.schema';
import { CatalogLesson } from './schemas/catalog-lesson.schema';
import { SeedCatalogSubjectDto } from './dto/seed-catalog.dto';
import { PaginationDto } from '../pagination/dto/pagination.dto';
import { getPagination } from '../pagination/common/paginationUtils';

@Injectable()
export class CatalogService {
  constructor(
    @InjectModel(CatalogSubject.name)
    private readonly subjects: Model<CatalogSubject>,
    @InjectModel(CatalogUnit.name) private readonly units: Model<CatalogUnit>,
    @InjectModel(CatalogLesson.name)
    private readonly lessons: Model<CatalogLesson>,
  ) {}
  async listSubjects(pagination: PaginationDto = {}) {
    const totalDocs = await this.subjects.countDocuments();
    const page = getPagination(pagination.page, pagination.limit, totalDocs);
    const data = await this.subjects
      .find()
      .sort({ name: 1, _id: 1 })
      .skip(page.skip)
      .limit(page.limit)
      .lean();
    return { data, totalDocs, totalPages: page.totalPages };
  }
  async getUnits(id: string) {
    if (!(await this.subjects.exists({ _id: id })))
      throw new NotFoundException('مادة الكتالوج غير موجودة');
    const units = await this.units
      .find({ catalogSubjectId: id })
      .sort({ order: 1, _id: 1 })
      .lean();
    const lessons = await this.lessons
      .find({ catalogUnitId: { $in: units.map((u) => u._id) } })
      .sort({ order: 1, _id: 1 })
      .lean();
    return units.map((unit) => ({
      ...unit,
      lessons: lessons.filter(
        (l) => String(l.catalogUnitId) === String(unit._id),
      ),
    }));
  }
  // Platform-only API; the offline parser sends one validated subject per request.
  async seedSubject(dto: SeedCatalogSubjectDto) {
    if (dto.lessons.some((l) => l.id.split(',')[0] !== dto.subjectId))
      throw new BadRequestException(
        'Lesson source ID does not belong to subject',
      );
    const subject = await this.subjects.findOneAndUpdate(
      { sourceId: dto.subjectId },
      { $set: { name: dto.subjectName } },
      { upsert: true, new: true, runValidators: true },
    );
    const units = new Map<
      string,
      { name: string; lessons: typeof dto.lessons }
    >();
    for (const lesson of dto.lessons) {
      const sourceId = lesson.id.split(',').slice(0, 2).join(',');
      if (!units.has(sourceId))
        units.set(sourceId, { name: lesson.unit, lessons: [] });
      units.get(sourceId).lessons.push(lesson);
    }
    let order = 0;
    for (const [sourceId, group] of units) {
      const unit = await this.units.findOneAndUpdate(
        { sourceId },
        {
          $set: {
            catalogSubjectId: subject._id,
            name: group.name,
            order: order++,
          },
        },
        { upsert: true, new: true, runValidators: true },
      );
      for (const [lessonOrder, lesson] of group.lessons.entries()) {
        await this.lessons.findOneAndUpdate(
          { sourceId: lesson.id },
          {
            $set: {
              catalogUnitId: unit._id,
              name: lesson.lessonName,
              order: lessonOrder,
            },
          },
          { upsert: true, runValidators: true },
        );
      }
    }
    return {
      subjectId: subject._id,
      units: units.size,
      lessons: dto.lessons.length,
    };
  }
}
