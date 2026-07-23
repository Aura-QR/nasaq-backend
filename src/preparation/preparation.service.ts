import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CreatePreparationDto } from './dto/create-preparation.dto';
import { UpdatePreparationDto } from './dto/update-preparation.dto';
import { Preparation } from './schemas/preparation.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Teacher } from '../teachers/schemas/teacher.schema';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PreparationService {
  constructor(
    @InjectModel(Preparation.name)
    private readonly preparationModel: Model<Preparation>,
    @InjectModel(Lecture.name)
    private readonly lectureModel: Model<Lecture>,
    @InjectModel(Teacher.name)
    private readonly teacherModel: Model<Teacher>,
  ) {}

  async create(
    createPreparationDto: CreatePreparationDto,
    userId: string,
    req: any,
    files?: Express.Multer.File[],
    user?: any,
  ) {
    const lecture = await this.lectureModel.findById(
      createPreparationDto.lecture,
    );
    if (!lecture) {
      throw new NotFoundException(
        `المحاضرة ذات المعرف ${createPreparationDto.lecture} غير موجودة`,
      );
    }

    let teacherId: string;
    let teacherName: string;

    if (user?.role === 'TEACHER') {
      if (lecture.teacherId.toString() !== userId) {
        throw new Error('المدرس لا يدرس هذه المحاضرة');
      }
      const teacher = await this.teacherModel.findById(userId);
      teacherId = userId;
      teacherName = teacher.name;
    } else if (user?.role === 'SUPERVISOR' || user?.role === 'OWNER') {
      const teacher = await this.teacherModel.findById(lecture.teacherId);
      if (!teacher) {
        throw new NotFoundException(
          `المدرس غير موجود للمحاضرة ${createPreparationDto.lecture}`,
        );
      }
      teacherId = teacher._id.toString();
      teacherName = teacher.name;
    }

    const savedPreparation = await new this.preparationModel({
      ...createPreparationDto,
      subject: lecture.subjectId,
      submittedBy: teacherId,
      name: teacherName,
    }).save();

  
    await this.lectureModel.findByIdAndUpdate(
      createPreparationDto.lecture,
      { $push: { preparation: savedPreparation._id } },
      { new: true }
    );

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    if (files && files.length > 0) {
      const preparationFolder = path.join(
        './uploads/preparation',
        savedPreparation._id.toString(),
      );

      if (!fs.existsSync(preparationFolder)) {
        fs.mkdirSync(preparationFolder, { recursive: true });
      }
      
      const movedFiles = [];

      for (const file of files) {
        const newPath = path.join(preparationFolder, file.filename);

        fs.renameSync(file.path, newPath);

        const relativePath = `/uploads/preparation/${savedPreparation._id}/${file.filename}`;
        const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;

        movedFiles.push({
          filename: file.filename,
          originalName: file.originalname,
          path: newPath,
          url: fullUrl,
          size: file.size,
        });
      }

      savedPreparation.files = movedFiles;
      await savedPreparation.save();
    }

    const populatedPreparation = await this.preparationModel
      .findById(savedPreparation._id)
      .populate({
        path: 'lecture',
        populate: {
          path: 'classId',
          select: 'academicYear roomNumber gender',
        },
      })
      .populate('subject')
      .populate('submittedBy', 'name email')
      .exec();

    const preparationWithUrls = this.addUrlsToFiles(
      populatedPreparation,
      baseUrl,
    );

    return {
      message: 'تم إنشاء التحضير بنجاح',
      data: preparationWithUrls,
    };
  }

  private addUrlsToFiles(preparation: any, baseUrl: string): any {
    const prepObj =
      typeof preparation.toObject === 'function'
        ? preparation.toObject()
        : preparation;

    if (prepObj.files && prepObj.files.length > 0) {
      prepObj.files = prepObj.files.map((file: any) => {
        const relativePath = `/uploads/preparation/${prepObj._id}/${file.filename}`;
        const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;
        return {
          ...file,
          url: fullUrl,
        };
      });
    }

  
    if (prepObj.lecture && prepObj.lecture.classId && typeof prepObj.lecture.classId === 'object' && prepObj.lecture.classId._id) {
      const classData = prepObj.lecture.classId;
      prepObj.academicYear = classData.academicYear;
      prepObj.roomNumber = classData.roomNumber;
      prepObj.gender = classData.gender;
      prepObj.class = {
        _id: classData._id,
        academicYear: classData.academicYear,
        gender: classData.gender,
        roomNumber: classData.roomNumber,
      };

   
      prepObj.lecture = {
        ...prepObj.lecture,
        classId: classData._id.toString(),
      };
    }

    return prepObj;
  }

  async filtering(
    filters: any,
    pagination: PaginationDto = {},
    user?: any,
    req?: any,
  ) {
    const query: any = {};

    const textSearchFields = ['name'];
    const arrayMatchFields = ['lecture'];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const stringValue = String(value);

      if (textSearchFields.includes(key)) {
        query[key] = { $regex: stringValue, $options: 'i' };
      } else if (arrayMatchFields.includes(key)) {
        query[key] = stringValue;
      } else {
        query[key] = stringValue;
      }
    }

    if (user?.role === 'TEACHER') {
      query['submittedBy'] = user.userId;
    }

    const total = await this.preparationModel.countDocuments(query).exec();

    const paginationMate = getPagination(
      pagination.page,
      pagination.limit,
      total,
    );

    const isPaginationRequested =
      pagination.page !== undefined || pagination.limit !== undefined;

    let preparationsQuery = this.preparationModel
      .find(query).sort({ createdAt: -1 })
      .populate('submittedBy', 'name email');

    if (isPaginationRequested) {
      preparationsQuery = preparationsQuery
        .skip(paginationMate.skip)
        .limit(paginationMate.limit);
    }

    const preparations = await preparationsQuery.exec();

    //only populate lecture/subject for docs that still have ObjectId refs (not yet cleaned by cron)
    const toPopulate = preparations.filter(
      (p) => Types.ObjectId.isValid(p.lecture as any) && String(p.lecture).length === 24,
    );
    if (toPopulate.length > 0) {
      await this.preparationModel.populate(toPopulate, [
        { path: 'lecture', populate: { path: 'classId', select: 'academicYear roomNumber gender' } },
        { path: 'subject' },
      ]);
    }
    const toPopulateSubject = preparations.filter(
      (p) => !toPopulate.includes(p) && Types.ObjectId.isValid(p.subject as any) && String(p.subject).length === 24,
    );
    if (toPopulateSubject.length > 0) {
      await this.preparationModel.populate(toPopulateSubject, [{ path: 'subject' }]);
    }
    const totalDocs = paginationMate.total;
    const totalPages = paginationMate.totalPages;
    
    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
    const preparationsWithUrls = preparations.map((preparation) =>
      this.addUrlsToFiles(preparation, baseUrl),
    );
  
    if (isPaginationRequested) {
      return {
        data: preparationsWithUrls,
        totalDocs,
        totalPages,
      };
    }

    return preparationsWithUrls;
  }

  async update(
    id: string,
    updatePreparationDto: UpdatePreparationDto,
    req: any,
    files?: Express.Multer.File[],
    user?: any,
  ) {
    const preparation = await this.preparationModel.findById(id);
    if (!preparation) {
      throw new NotFoundException(`التحضير ذو المعرف ${id} غير موجود`);
    }

    if (
      user?.role === 'TEACHER' &&
      preparation.submittedBy.toString() !== user.userId
    ) {
      throw new Error('ليس مسموحاً لك بتحديث هذا التحضير');
    }

    if (updatePreparationDto.lecture) {
      const newLecture = await this.lectureModel.findById(
        updatePreparationDto.lecture,
      );
      if (!newLecture) {
        throw new NotFoundException(
          `المحاضرة ذات المعرف ${updatePreparationDto.lecture} غير موجودة`,
        );
      }


      if (
        user?.role === 'TEACHER' &&
        newLecture.teacherId.toString() !== user.userId
      ) {
        throw new Error('المدرس لا يدرس هذه المحاضرة');
      }

   
      if (preparation.lecture.toString() !== updatePreparationDto.lecture) {
        await this.lectureModel.findByIdAndUpdate(
          preparation.lecture,
          { $pull: { preparation: id } },
          { new: true }
        );

        await this.lectureModel.findByIdAndUpdate(
          updatePreparationDto.lecture,
          { $push: { preparation: id } },
          { new: true }
        );
      }

      updatePreparationDto['subject'] = newLecture.subjectId;
    }

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    if (files && files.length > 0) {
      const preparationFolder = path.join('./uploads/preparation', id);
      if (fs.existsSync(preparationFolder)) {
        fs.rmSync(preparationFolder, { recursive: true, force: true });
      }

      fs.mkdirSync(preparationFolder, { recursive: true });

      const newFiles = [];

      for (const file of files) {
        const newPath = path.join(preparationFolder, file.filename);

        fs.renameSync(file.path, newPath);

        newFiles.push({
          filename: file.filename,
          originalName: file.originalname,
          path: newPath,
          size: file.size,
        });
      }

      updatePreparationDto['files'] = newFiles;
    }

    const updatedPreparation = await this.preparationModel
      .findByIdAndUpdate(id, updatePreparationDto, { new: true })
      .populate({
        path: 'lecture',
        populate: {
          path: 'classId',
          select: 'academicYear roomNumber gender',
        },
      })
      .populate('subject')
      .populate('submittedBy', 'name email')
      .exec();

    const preparationWithUrls = this.addUrlsToFiles(
      updatedPreparation,
      baseUrl,
    );

    return {
      message: 'تم تحديث التحضير بنجاح',
      data: preparationWithUrls,
    };
  }

  async delete(id: string, user?: any) {
    const preparation = await this.preparationModel.findById(id);
    if (!preparation) {
      throw new NotFoundException(`التحضير ذو المعرف ${id} غير موجود`);
    }

    if (
      user?.role === 'TEACHER' &&
      preparation.submittedBy.toString() !== user.userId
    ) {
      throw new Error('ليس مسموحاً لك بحذف هذا التحضير');
    }

    const preparationFolder = path.join('./uploads/preparation', id);
    if (fs.existsSync(preparationFolder)) {
      fs.rmSync(preparationFolder, { recursive: true, force: true });
    }

    await this.lectureModel.findByIdAndUpdate(
      preparation.lecture,
      { $pull: { preparation: id } },
      { new: true }
    );

    await this.preparationModel.findByIdAndDelete(id);
    return {
      message: `تم حذف التحضير ذو المعرف ${id} بنجاح`,
      data: preparation,
    };
  }

  async findOne(id: string, req?: any) {
    const preparation = await this.preparationModel
      .findById(id)
      .populate('submittedBy', 'name email')
      .exec();
    if (!preparation) {
      throw new NotFoundException(`التحضير ذو المعرف ${id} غير موجود`);
    }

    //only populate lecture/subject if they are still ObjectId refs
    if (Types.ObjectId.isValid(preparation.lecture as any) && String(preparation.lecture).length === 24) {
      await this.preparationModel.populate(preparation, [
        { path: 'lecture', populate: { path: 'classId', select: 'academicYear roomNumber gender' } },
      ]);
    }
    if (Types.ObjectId.isValid(preparation.subject as any) && String(preparation.subject).length === 24) {
      await this.preparationModel.populate(preparation, [{ path: 'subject' }]);
    }

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
    const preparationWithUrls = this.addUrlsToFiles(preparation, baseUrl);

    return preparationWithUrls;
  }

  async addFiles(
    id: string,
    req: any,
    files?: Express.Multer.File[],
    user?: any,
  ) {
    const preparation = await this.preparationModel.findById(id);
    if (!preparation) {
      throw new NotFoundException(`التحضير ذو المعرف ${id} غير موجود`);
    }

    if (
      user?.role === 'TEACHER' &&
      preparation.submittedBy.toString() !== user.userId
    ) {
      throw new Error('ليس مسموحاً لك بإضافة ملفات لهذا التحضير');
    }

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    if (!files || files.length === 0) {
      throw new Error('لم يتم توفير ملفات');
    }

    const preparationFolder = path.join('./uploads/preparation', id);

    if (!fs.existsSync(preparationFolder)) {
      fs.mkdirSync(preparationFolder, { recursive: true });
    }

    const existingFiles = preparation.files || [];

    for (const file of files) {
      const newPath = path.join(preparationFolder, file.filename);

      fs.renameSync(file.path, newPath);

      existingFiles.push({
        filename: file.filename,
        originalName: file.originalname,
        path: newPath,
        size: file.size,
      });
    }

    preparation.files = existingFiles;
    await preparation.save();

    const updatedPreparation = await this.preparationModel
      .findById(id)
      .populate({
        path: 'lecture',
        populate: {
          path: 'classId',
          select: 'academicYear roomNumber gender',
        },
      })
      .populate('subject')
      .populate('submittedBy', 'name email')
      .exec();

    const preparationWithUrls = this.addUrlsToFiles(
      updatedPreparation,
      baseUrl,
    );

    return {
      message: 'تم إضافة الملفات بنجاح',
      data: preparationWithUrls,
    };
  }

  async removeFile(id: string, filename: string, user?: any, req?: any) {
    const preparation = await this.preparationModel.findById(id);
    if (!preparation) {
      throw new NotFoundException(`التحضير ذو المعرف ${id} غير موجود`);
    }

    if (
      user?.role === 'TEACHER' &&
      preparation.submittedBy.toString() !== user.userId
    ) {
      throw new Error('ليس مسموحاً لك بإزالة ملفات من هذا التحضير');
    }

    const fileIndex = preparation.files.findIndex(
      (file) => file.filename === filename,
    );

    if (fileIndex === -1) {
      throw new NotFoundException(`الملف ${filename} غير موجود في التحضير`);
    }

    const fileToRemove = preparation.files[fileIndex];
    const filePath = fileToRemove.path;

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    preparation.files.splice(fileIndex, 1);
    await preparation.save();

    const baseUrl =
      req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    const updatedPreparation = await this.preparationModel
      .findById(id)
      .populate({
        path: 'lecture',
        populate: {
          path: 'classId',
          select: 'academicYear roomNumber gender',
        },
      })
      .populate('subject')
      .populate('submittedBy', 'name email')
      .exec();

    const preparationWithUrls = this.addUrlsToFiles(
      updatedPreparation,
      baseUrl,
    );

    return {
      message: `تم إزالة الملف ${filename} بنجاح`,
      data: preparationWithUrls,
    };
  }
}
