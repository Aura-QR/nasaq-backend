import { ConflictException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as mongoose from 'mongoose';
import { Term } from './schemas/term.schema';
import { CreateTermDto } from './dto/create-term.dto';
import { UpdateTermDto } from './dto/update-term.dto';
import { TermItemDto } from './dto/create-terms-bulk.dto';

@Injectable()
export class TermsService {
  constructor(
    @InjectModel(Term.name) private readonly termModel: Model<Term>,
  ) {}

  async create(createTermDto: CreateTermDto) {
    const existing = await this.termModel.findOne({
      academicYearId: new mongoose.Types.ObjectId(createTermDto.academicYearId),
      order: createTermDto.order,
    }).exec();

    if (existing) {
      throw new ConflictException(
        `Term with order ${createTermDto.order} already exists for this academic year`,
      );
    }

    const term = new this.termModel(createTermDto);
    return term.save();
  }

  async createBulk(academicYearId: string, terms: TermItemDto[]) {
    // Validate no duplicate orders in the input
    const orders = terms.map((t) => t.order);
    const uniqueOrders = new Set(orders);
    if (uniqueOrders.size !== orders.length) {
      throw new BadRequestException('Duplicate term orders found in the input');
    }

    // Check for existing terms with conflicting orders
    const existingTerms = await this.termModel.find({
      academicYearId: new mongoose.Types.ObjectId(academicYearId),
      order: { $in: orders },
    }).exec();

    if (existingTerms.length > 0) {
      const conflictingOrders = existingTerms.map((t) => t.order).join(', ');
      throw new ConflictException(
        `Terms with orders [${conflictingOrders}] already exist for this academic year`,
      );
    }

    const termDocs = terms.map((t) => ({
      ...t,
      academicYearId: new mongoose.Types.ObjectId(academicYearId),
      status: 'upcoming',
    }));

    return this.termModel.insertMany(termDocs);
  }

  async findByAcademicYear(academicYearId: string) {
    return this.termModel
      .find({ academicYearId: new mongoose.Types.ObjectId(academicYearId) })
      .sort({ order: 1 })
      .exec();
  }

  async findOne(id: string) {
    const term = await this.termModel.findById(id).exec();
    if (!term) {
      throw new NotFoundException(`Term with ID ${id} not found`);
    }
    return term;
  }

  async update(id: string, updateTermDto: UpdateTermDto) {
    const updatedTerm = await this.termModel
      .findByIdAndUpdate(id, updateTermDto, { new: true })
      .exec();

    if (!updatedTerm) {
      throw new NotFoundException(`Term with ID ${id} not found`);
    }
    return updatedTerm;
  }

  async remove(id: string) {
    const deletedTerm = await this.termModel.findByIdAndDelete(id).exec();
    if (!deletedTerm) {
      throw new NotFoundException(`Term with ID ${id} not found`);
    }
    return deletedTerm;
  }

  async copyFromYear(
    targetAcademicYearId: string,
    sourceAcademicYearId: string,
    termOverrides?: { order: number; startDate: string; endDate: string }[],
  ) {
    const sourceTerms = await this.termModel
      .find({ academicYearId: new mongoose.Types.ObjectId(sourceAcademicYearId) })
      .sort({ order: 1 })
      .exec();

    if (sourceTerms.length === 0) {
      throw new NotFoundException('No terms found in the source academic year');
    }

    // Check for existing terms in target year
    const existingTargetTerms = await this.termModel
      .find({ academicYearId: new mongoose.Types.ObjectId(targetAcademicYearId) })
      .exec();

    if (existingTargetTerms.length > 0) {
      throw new ConflictException(
        'Target academic year already has terms. Remove them first or use manual creation.',
      );
    }

    // Build override lookup by order
    const overrideLookup = new Map<number, { startDate: string; endDate: string }>();
    if (termOverrides) {
      for (const override of termOverrides) {
        overrideLookup.set(override.order, {
          startDate: override.startDate,
          endDate: override.endDate,
        });
      }
    }

    const newTermDocs = sourceTerms.map((sourceTerm) => {
      const override = overrideLookup.get(sourceTerm.order);
      return {
        academicYearId: new mongoose.Types.ObjectId(targetAcademicYearId),
        name: sourceTerm.name,
        order: sourceTerm.order,
        startDate: override ? new Date(override.startDate) : sourceTerm.startDate,
        endDate: override ? new Date(override.endDate) : sourceTerm.endDate,
        status: 'upcoming',
      };
    });

    return this.termModel.insertMany(newTermDocs);
  }
}
