import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { SubjectOffering } from './schemas/subject-offering.schema';
import { Term } from '../terms/schemas/term.schema';
import { CreateSubjectOfferingDto } from './dto/create-subject-offering.dto';

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
    });

    return offering.save();
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
