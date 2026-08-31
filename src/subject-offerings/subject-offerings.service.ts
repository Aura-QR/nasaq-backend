import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { SubjectOffering } from './schemas/subject-offering.schema';
import { Term } from '../terms/schemas/term.schema';
import { CreateSubjectOfferingDto } from './dto/create-subject-offering.dto';
import { UpdateSubjectOfferingDto } from './dto/update-subject-offering.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';

@Injectable()
export class SubjectOfferingsService {
  constructor(
    @InjectModel(SubjectOffering.name)
    private readonly subjectOfferingModel: Model<SubjectOffering>,
    @InjectModel(Term.name)
    private readonly termModel: Model<Term>,
  ) {}

  async create(dto: CreateSubjectOfferingDto) {
    const existing = await this.subjectOfferingModel.findOne({
      subjectId: new mongoose.Types.ObjectId(dto.subjectId),
      gradeLevelId: new mongoose.Types.ObjectId(dto.gradeLevelId),
      termId: new mongoose.Types.ObjectId(dto.termId),
    }).exec();

    if (existing) {
      throw new ConflictException('This subject offering already exists for the given grade level and term');
    }

    const offering = new this.subjectOfferingModel({
      subjectId: new mongoose.Types.ObjectId(dto.subjectId),
      gradeLevelId: new mongoose.Types.ObjectId(dto.gradeLevelId),
      termId: new mongoose.Types.ObjectId(dto.termId),
      periodsPerWeek: dto.periodsPerWeek ?? 0,
    });

    return offering.save();
  }

  async update(id: string, dto: UpdateSubjectOfferingDto) {
    const updated = await this.subjectOfferingModel
      .findByIdAndUpdate(id, dto, { new: true, runValidators: true })
      .populate('subjectId', 'subjectName subjectCode')
      .populate('gradeLevelId', 'name order')
      .exec();

    if (!updated) {
      throw new NotFoundException(`Subject offering with ID ${id} not found`);
    }
    return updated;
  }

  /**
   * Saves a whole teaching plan in one write.
   *
   * The plan is entered as a grid — a grade's subjects down one side, a period
   * count against each — so it is saved as a grid. Thirty separate PATCHes to
   * store one screen would make a half-saved plan the normal outcome.
   *
   * Ids are verified against the school's own offerings before anything is
   * written, so an id from another tenant cannot slip through bulkWrite, which
   * does not run the tenant plugin's query hooks.
   */
  async updatePlan(dto: UpdatePlanDto) {
    const ids = dto.entries.map((e) => new mongoose.Types.ObjectId(e.subjectOfferingId));

    const owned = await this.subjectOfferingModel
      .find({ _id: { $in: ids } })
      .select('_id')
      .lean()
      .exec();
    const ownedIds = new Set(owned.map((o: any) => String(o._id)));

    const unknown = dto.entries
      .map((e) => e.subjectOfferingId)
      .filter((id) => !ownedIds.has(String(id)));

    if (unknown.length > 0) {
      throw new NotFoundException(
        `Subject offerings not found: ${unknown.join(', ')}`,
      );
    }

    const result = await this.subjectOfferingModel.bulkWrite(
      dto.entries.map((entry) => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(entry.subjectOfferingId) },
          update: { $set: { periodsPerWeek: entry.periodsPerWeek } },
        },
      })),
    );

    return {
      message: `${dto.entries.length} subject offerings updated`,
      matched: result.matchedCount,
      modified: result.modifiedCount,
    };
  }

  async findAll(filters: { termId?: string; gradeLevelId?: string } = {}) {
    const filter: any = {};
    if (filters.termId) {
      filter.termId = new mongoose.Types.ObjectId(filters.termId);
    }
    if (filters.gradeLevelId) {
      filter.gradeLevelId = new mongoose.Types.ObjectId(filters.gradeLevelId);
    }

    return this.subjectOfferingModel
      .find(filter)
      .populate('subjectId', 'subjectName subjectCode')
      .populate('gradeLevelId', 'name order')
      .populate('termId', 'name order status')
      .exec();
  }

  async findByTerm(termId: string, gradeLevelId?: string) {
    const filter: any = { termId: new mongoose.Types.ObjectId(termId) };
    if (gradeLevelId) {
      filter.gradeLevelId = new mongoose.Types.ObjectId(gradeLevelId);
    }

    return this.subjectOfferingModel
      .find(filter)
      .populate('subjectId', 'subjectName subjectCode')
      .populate('gradeLevelId', 'name order')
      .populate('termId', 'name order status')
      .exec();
  }

  async findOne(id: string) {
    const offering = await this.subjectOfferingModel
      .findById(id)
      .populate('subjectId', 'subjectName subjectCode')
      .populate('gradeLevelId', 'name order')
      .populate('termId', 'name order status')
      .exec();

    if (!offering) {
      throw new NotFoundException(`Subject offering with ID ${id} not found`);
    }
    return offering;
  }

  async remove(id: string) {
    const deleted = await this.subjectOfferingModel.findByIdAndDelete(id).exec();
    if (!deleted) {
      throw new NotFoundException(`Subject offering with ID ${id} not found`);
    }
    return deleted;
  }

  /**
   * Wizard Step 6 — Copy subject offerings across academic years.
   * Matches terms by order (e.g. source Term 1 -> target Term 1).
   */
  async copyFromYear(targetAcademicYearId: string, sourceAcademicYearId: string) {
    const sourceTerms = await this.termModel
      .find({ academicYearId: new mongoose.Types.ObjectId(sourceAcademicYearId) })
      .exec();
    const targetTerms = await this.termModel
      .find({ academicYearId: new mongoose.Types.ObjectId(targetAcademicYearId) })
      .exec();

    if (sourceTerms.length === 0 || targetTerms.length === 0) {
      throw new NotFoundException('Source or target academic year has no terms configured');
    }

    // Map source term ID -> target term ID by matching term `order`
    const targetTermByOrder = new Map<number, mongoose.Types.ObjectId>();
    for (const tt of targetTerms) {
      targetTermByOrder.set(tt.order, tt._id as mongoose.Types.ObjectId);
    }

    const sourceTermIds = sourceTerms.map((t) => t._id);
    const sourceOfferings = await this.subjectOfferingModel
      .find({ termId: { $in: sourceTermIds } })
      .exec();

    if (sourceOfferings.length === 0) {
      throw new NotFoundException('No subject offerings found in source academic year');
    }

    const termOrderMap = new Map<string, number>();
    for (const st of sourceTerms) {
      termOrderMap.set(st._id.toString(), st.order);
    }

    const newOfferings = [];
    for (const sourceOffering of sourceOfferings) {
      const order = termOrderMap.get(sourceOffering.termId.toString());
      if (order === undefined) continue;

      const targetTermId = targetTermByOrder.get(order);
      if (!targetTermId) continue;

      newOfferings.push({
        subjectId: sourceOffering.subjectId,
        gradeLevelId: sourceOffering.gradeLevelId,
        termId: targetTermId,
        // The teaching plan barely changes year to year. Not carrying it
        // across would leave every new year unplanned, and the generator with
        // nothing to schedule.
        periodsPerWeek: sourceOffering.periodsPerWeek ?? 0,
      });
    }

    const created = await this.subjectOfferingModel.insertMany(newOfferings);
    return {
      message: `${created.length} subject offerings copied successfully`,
      createdCount: created.length,
      offerings: created,
    };
  }
}
