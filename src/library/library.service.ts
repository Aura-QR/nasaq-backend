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
import { transformLibraryResponse } from './transforms/response.transform';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';

@Injectable()
export class LibraryService {
  private static readonly SUBJECT_OFFERING_POPULATE = {
    path: 'subjectOfferingId',
    populate: [
      { path: 'subjectId', select: 'subjectCode subjectName' },
      { path: 'termId', select: 'name startDate endDate' },
      { path: 'gradeLevelId', select: 'name' },
    ],
  };

  constructor(
    @InjectModel(Library.name)
    private readonly libraryModel: Model<Library>,
    @InjectModel(SubjectOffering.name)
    private readonly subjectOfferingModel: Model<SubjectOffering>,
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
    await this.checkForDuplicate(createLibraryDto.title, createLibraryDto.link);
    await this.validateSubjectOffering(createLibraryDto.subjectOfferingId);

    const library = new this.libraryModel(createLibraryDto);
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

  async update(id: string, updateLibraryDto: UpdateLibraryDto) {
    if (updateLibraryDto.title || updateLibraryDto.link) {
      const currentLibrary = await this.libraryModel.findById(id);

      if (!currentLibrary) {
        throw new NotFoundException(`Library item with ID ${id} not found`);
      }

      const title = updateLibraryDto.title || currentLibrary.title;
      const link = updateLibraryDto.link || currentLibrary.link;

      await this.checkForDuplicate(title, link, id);
    }

    await this.validateSubjectOffering(updateLibraryDto.subjectOfferingId);

    const library = await this.libraryModel
      .findByIdAndUpdate(id, updateLibraryDto, { new: true })
      .populate(LibraryService.SUBJECT_OFFERING_POPULATE)
      .exec();

    if (!library) {
      throw new NotFoundException(`Library item with ID ${id} not found`);
    }

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

    const textSearchFields = ['title', 'academicYear'];
    const referenceFields = ['subjectOfferingId'];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (textSearchFields.includes(key)) {
        query[key] = { $regex: stringValue, $options: 'i' };
      } else if (referenceFields.includes(key)) {
        query[key] = new mongoose.Types.ObjectId(stringValue);
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
