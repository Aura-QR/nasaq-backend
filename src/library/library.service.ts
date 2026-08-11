import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { CreateLibraryDto } from './dto/create-library.dto';
import { UpdateLibraryDto } from './dto/update-library.dto';
import { Library } from './schemas/library.schema';
import { SubjectOffering } from '../subject-offerings/schemas/subject-offering.schema';
import { Term } from '../terms/schemas/term.schema';
import { transformLibraryResponse } from './transforms/response.transform';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';

@Injectable()
export class LibraryService {
  private static readonly SUBJECT_OFFERING_POPULATE = {
    path: 'subjectOfferingId',
    populate: [
      { path: 'subjectId', select: 'subjectCode subjectName' },
      { path: 'termId', select: 'name startDate endDate academicYearId' },
      { path: 'gradeLevelId', select: 'name' },
    ],
  };

  constructor(
    @InjectModel(Library.name)
    private readonly libraryModel: Model<Library>,
    @InjectModel(SubjectOffering.name)
    private readonly subjectOfferingModel: Model<SubjectOffering>,
    @InjectModel(Term.name)
    private readonly termModel: Model<Term>,
  ) {}

  private async validateSubjectOffering(subjectOfferingId?: string): Promise<void> {
    if (!subjectOfferingId) return;
    if (!mongoose.Types.ObjectId.isValid(subjectOfferingId)) {
      throw new BadRequestException('صيغة معرف عرض المادة غير صحيحة');
    }
    const offering = await this.subjectOfferingModel.findById(subjectOfferingId);
    if (!offering) {
      throw new NotFoundException(`Subject offering with ID ${subjectOfferingId} not found`);
    }
  }

  private async resolveSubjectOfferingId(
    subjectOfferingId?: string,
    subjectId?: string,
    academicYearId?: string,
    fallbackOfferingId?: mongoose.Types.ObjectId,
  ): Promise<string | undefined> {
    if (subjectOfferingId) {
      await this.validateSubjectOffering(subjectOfferingId);
      return subjectOfferingId;
    }

    let effSubjectId = subjectId;
    let effAcademicYearId = academicYearId;

    if (!effSubjectId && fallbackOfferingId) {
      const currentOffering = await this.subjectOfferingModel.findById(fallbackOfferingId);
      if (currentOffering) {
        effSubjectId = currentOffering.subjectId.toString();
      }
    }

    if (!effSubjectId && !effAcademicYearId) {
      return undefined;
    }

    const offeringQuery: any = {};
    if (effSubjectId) {
      if (!mongoose.Types.ObjectId.isValid(effSubjectId)) {
        throw new BadRequestException('صيغة معرف المادة غير صحيحة');
      }
      offeringQuery.subjectId = new mongoose.Types.ObjectId(effSubjectId);
    }

    if (effAcademicYearId) {
      if (!mongoose.Types.ObjectId.isValid(effAcademicYearId)) {
        throw new BadRequestException('صيغة معرف السنة الدراسية غير صحيحة');
      }
      const terms = await this.termModel
        .find({ academicYearId: new mongoose.Types.ObjectId(effAcademicYearId) })
        .select('_id')
        .exec();
      const termIds = terms.map((t) => t._id);
      offeringQuery.termId = { $in: termIds };
    }

    const offering = await this.subjectOfferingModel.findOne(offeringQuery);
    if (!offering) {
      throw new NotFoundException('لم يتم العثور على عرض لهذه المادة للسنة الدراسية المحددة');
    }

    return offering._id.toString();
  }

  private async checkForDuplicate(title: string, link: string, excludeId?: string): Promise<void> {
    const query: any = { title, link };
    if (excludeId) query._id = { $ne: excludeId };
    const existing = await this.libraryModel.findOne(query);
    if (existing) {
      throw new ConflictException(
        'عذرا هذه البيانات ادخلت سابقا يرجي تغيير الاسم, او اللينك الخاص بالمادة',
      );
    }
  }

  async create(createLibraryDto: CreateLibraryDto) {
    const { subjectOfferingId, subjectId, academicYearId, ...libraryFields } = createLibraryDto as any;

    const resolvedOfferingId = await this.resolveSubjectOfferingId(
      subjectOfferingId,
      subjectId,
      academicYearId,
    );

    await this.checkForDuplicate(createLibraryDto.title, createLibraryDto.link);

    const libraryData: any = { ...libraryFields };
    if (resolvedOfferingId) {
      libraryData.subjectOfferingId = new mongoose.Types.ObjectId(resolvedOfferingId);
    }

    const library = new this.libraryModel(libraryData);
    await library.save();

    await library.populate(LibraryService.SUBJECT_OFFERING_POPULATE);

    return transformLibraryResponse(library);
  }

  async findAll() {
    const libraries = await this.libraryModel
      .find()
      .populate(LibraryService.SUBJECT_OFFERING_POPULATE)
      .exec();

    return libraries.map((library) => transformLibraryResponse(library));
  }

  async findOne(id: string) {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new BadRequestException('صيغة المعرف غير صحيحة');
    }

    const library = await this.libraryModel
      .findById(id)
      .populate(LibraryService.SUBJECT_OFFERING_POPULATE)
      .exec();

    if (!library) {
      throw new NotFoundException(`العنصر ذو المعرف ${id} غير موجود في المكتبة`);
    }

    return transformLibraryResponse(library);
  }

  async findBySubject(subjectId: string) {
    if (!mongoose.Types.ObjectId.isValid(subjectId)) {
      throw new BadRequestException('صيغة معرف المادة غير صحيحة');
    }

    // A subject has one offering per (grade level x term), so collect them all
    // before looking up the library items attached to any of them.
    const offerings = await this.subjectOfferingModel
      .find({ subjectId: new mongoose.Types.ObjectId(subjectId) })
      .select('_id')
      .exec();

    const libraries = await this.libraryModel
      .find({ subjectOfferingId: { $in: offerings.map((o) => o._id) } })
      .populate(LibraryService.SUBJECT_OFFERING_POPULATE)
      .exec();

    return libraries.map((library) => transformLibraryResponse(library));
  }

  async update(id: string, updateLibraryDto: UpdateLibraryDto) {
    const currentLibrary = await this.libraryModel.findById(id);

    if (!currentLibrary) {
      throw new NotFoundException(`Library item with ID ${id} not found`);
    }

    if (updateLibraryDto.title || updateLibraryDto.link) {
      const title = updateLibraryDto.title || currentLibrary.title;
      const link = updateLibraryDto.link || currentLibrary.link;

      await this.checkForDuplicate(title, link, id);
    }

    const { subjectOfferingId, subjectId, academicYearId, ...otherFields } = updateLibraryDto as any;

    let resolvedOfferingId: string | undefined;
    if (subjectOfferingId || subjectId || academicYearId) {
      resolvedOfferingId = await this.resolveSubjectOfferingId(
        subjectOfferingId,
        subjectId,
        academicYearId,
        currentLibrary.subjectOfferingId,
      );
    }

    const updatePayload: any = { ...otherFields };
    if (resolvedOfferingId !== undefined) {
      updatePayload.subjectOfferingId = new mongoose.Types.ObjectId(resolvedOfferingId);
    }

    const library = await this.libraryModel
      .findByIdAndUpdate(id, updatePayload, { new: true })
      .populate(LibraryService.SUBJECT_OFFERING_POPULATE)
      .exec();

    return {
      message: 'Library item updated successfully',
      data: transformLibraryResponse(library),
    };
  }

  async remove(id: string) {
    const libraryToDelete = await this.libraryModel.findById(id);

    if (!libraryToDelete) {
      throw new NotFoundException(`Library item with ID ${id} not found`);
    }

    const deletedLibrary = await this.libraryModel.findByIdAndDelete(id)
      .populate(LibraryService.SUBJECT_OFFERING_POPULATE)
      .exec();

    return {
      message: 'Library item deleted successfully',
      data: transformLibraryResponse(deletedLibrary)
    };
  }

  async list() {
    const libraries = await this.libraryModel.find().exec();

    return libraries.map((library) => ({
      id: library._id,
      title: library.title,
    }));
  }

  async filtering(filters: any, pagination: PaginationDto = {}) {
    const query: any = {};
    const offeringQuery: any = {};
    let filterByOffering = false;

    if (filters.subjectOfferingId) {
      if (mongoose.Types.ObjectId.isValid(String(filters.subjectOfferingId))) {
        query.subjectOfferingId = new mongoose.Types.ObjectId(String(filters.subjectOfferingId));
      }
    } else {
      if (filters.subjectId) {
        if (mongoose.Types.ObjectId.isValid(String(filters.subjectId))) {
          offeringQuery.subjectId = new mongoose.Types.ObjectId(String(filters.subjectId));
          filterByOffering = true;
        }
      }
      if (filters.academicYearId) {
        if (mongoose.Types.ObjectId.isValid(String(filters.academicYearId))) {
          const terms = await this.termModel
            .find({ academicYearId: new mongoose.Types.ObjectId(String(filters.academicYearId)) })
            .select('_id')
            .exec();
          offeringQuery.termId = { $in: terms.map((t) => t._id) };
          filterByOffering = true;
        }
      }

      if (filterByOffering) {
        const offerings = await this.subjectOfferingModel.find(offeringQuery).select('_id').exec();
        const offeringIds = offerings.map((o) => o._id);
        query.subjectOfferingId = { $in: offeringIds };
      }
    }

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (['page', 'limit', 'subjectOfferingId', 'subjectId', 'academicYearId'].includes(key)) continue;

      const stringValue = String(value);

      if (key === 'title' || key === 'academicYear') {
        query[key] = { $regex: stringValue, $options: 'i' };
      } else {
        query[key] = stringValue;
      }
    }

    const total = await this.libraryModel.countDocuments(query).exec();

    const paginationMeta = getPagination(pagination.page, pagination.limit, total);

    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let librariesQuery = this.libraryModel
      .find(query).sort({ createdAt: -1 })
      .populate(LibraryService.SUBJECT_OFFERING_POPULATE);

    if (isPaginationRequested) {
      librariesQuery = librariesQuery.skip(paginationMeta.skip).limit(paginationMeta.limit);
    }

    const libraries = await librariesQuery.exec();
    const totalDocs = total;
    const totalPages = paginationMeta.totalPages;

    if (isPaginationRequested) {
      return {
        data: libraries.map((library) => transformLibraryResponse(library)),
        totalDocs,
        totalPages
      };
    }

    return libraries.map((library) => transformLibraryResponse(library));
  }
}
