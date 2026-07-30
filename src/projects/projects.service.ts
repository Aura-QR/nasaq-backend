import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { Model } from 'mongoose';
import { Project } from './schemas/project.schema';
import { ProjectSubmission } from './schemas/project-submission.schema';
import { GradesCriteria } from '../grades-criteria/schemas/grades-criteria.schema';
import { Lecture } from '../lectures/schemas/lecture.schema';
import { Student } from '../students/schemas/student.schema';
import { CreateProjectDto } from './dto/create-project.dto';
import * as fs from 'fs';
import * as path from 'path';
import archiver from 'archiver';
import { PaginationDto } from 'src/pagination/dto/pagination.dto';
import { getPagination } from 'src/pagination/common/paginationUtils';
import { Response } from 'express';
import { transformProjectResponse } from './transforms/response.transform';

@Injectable()
export class ProjectsService {
  private static readonly CLASS_FIELDS = 'roomNumber academicYear gender';
  private static readonly GRADES_CRITERIA_FIELDS = 'academicYear projects';
  private static readonly SUBJECT_FIELDS = 'subjectCode subjectName';

  constructor(
    @InjectModel(Project.name) private projectModel: Model<Project>,
    @InjectModel(ProjectSubmission.name) private submissionModel: Model<ProjectSubmission>,
    @InjectModel(GradesCriteria.name)
    private gradesCriteriaModel: Model<GradesCriteria>,
    @InjectModel(Lecture.name) private lectureModel: Model<Lecture>,
    @InjectModel(Student.name) private studentModel: Model<Student>,
  ) {}

  /**
   * Verify that a teacher teaches the specified classes with the given subject
   */
  private async verifyTeacherClassAccess(
    teacherId: string,
    classIds: string[],
    subjectId: string,
  ): Promise<void> {
    // Find all lectures where this teacher teaches this subject
    const lectures = await this.lectureModel
      .find({
        teacherId: new mongoose.Types.ObjectId(teacherId),
        subjectId: new mongoose.Types.ObjectId(subjectId),
      })
      .exec();

    // Get the class IDs the teacher teaches for this subject
    const teacherClassIds = lectures.map((lecture: any) => lecture.classId.toString());

    // Check if all requested classIds are in the teacher's classes
    const unauthorizedClasses = classIds.filter(
      (classId) => !teacherClassIds.includes(classId),
    );

    if (unauthorizedClasses.length > 0) {
      throw new ForbiddenException(
        `ليس لديك صلاحية لإنشاء مشاريع/امتحانات للفصول: ${unauthorizedClasses.join(', ')}. يمكنك الإنشاء فقط للفصول التي تدرس فيها هذه المادة.`,
      );
    }
  }

  async create(
    createProjectDto: CreateProjectDto,
    req: any,
    files?: Express.Multer.File[],
    user?: any,
  ): Promise<any> {
    // If user is a teacher, verify they teach these classes with this subject
    if (user?.role === 'TEACHER') {
      await this.verifyTeacherClassAccess(
        user.userId,
        createProjectDto.classIds,
        createProjectDto.subjectId,
      );
    }

    const gradesCriteria = await this.gradesCriteriaModel.findOne({
      subjectId: createProjectDto.subjectId,
      academicYearId: createProjectDto.academicYearId,
    });

    if (!gradesCriteria) {
      throw new NotFoundException(
        `معايير التقييم غير موجودة للمادة ${createProjectDto.subjectId} لهذا العام الدراسي`,
      );
    }

    if (!gradesCriteria.projects) {
      throw new BadRequestException(
        `هذه المادة غير مكونة للمشاريع في معايير التقييم لهذا العام الدراسي`
      );
    }

    const projectsCount = (gradesCriteria as any).projectsCount || 1;
    const calculatedGrade = gradesCriteria.projects / projectsCount;

    const savedProject = await new this.projectModel({
      ...createProjectDto,
      termId: createProjectDto.termId ? new mongoose.Types.ObjectId(createProjectDto.termId) : null,
      gradesCriteriaId: gradesCriteria._id,
      grade: calculatedGrade,
      createdBy: user?.userId
    }).save();

    const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    if (files && files.length > 0) {
      const projectFolder = path.join('./uploads/projects', savedProject._id.toString());

      if (!fs.existsSync(projectFolder)) {
        fs.mkdirSync(projectFolder, { recursive: true });
      }

      const movedFiles = [];

      for (const file of files) {
        const newPath = path.join(projectFolder, file.filename);

        fs.renameSync(file.path, newPath);

        const relativePath = `/uploads/projects/${savedProject._id}/${file.filename}`;
        const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;

        movedFiles.push({
          filename: file.filename,
          originalName: file.originalname,
          path: newPath,
          url: fullUrl,
          size: file.size,
        });
      }

      savedProject.files = movedFiles;
      await savedProject.save();
    }

    const populatedProject = await this.projectModel
      .findById(savedProject._id)
      .populate({ path: 'gradesCriteriaId', select: ProjectsService.GRADES_CRITERIA_FIELDS })
      .populate({ path: 'subjectId', select: ProjectsService.SUBJECT_FIELDS })
      .populate({ path: 'classIds', select: ProjectsService.CLASS_FIELDS })
      .exec();

    const transformedProject = transformProjectResponse(populatedProject);

    if (transformedProject.files && transformedProject.files.length > 0) {
      transformedProject.files = transformedProject.files.map((file: any) => {
        const relativePath = `/uploads/projects/${transformedProject._id}/${file.filename}`;
        const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;
        return {
          ...file,
          url: fullUrl
        };
      });
    }

    return transformedProject;
  }

  async findOne(id: string, req: any, user?: any): Promise<any> {
    const project = await this.projectModel
      .findById(id)
      .populate({ path: 'gradesCriteriaId', select: ProjectsService.GRADES_CRITERIA_FIELDS })
      .populate({ path: 'subjectId', select: ProjectsService.SUBJECT_FIELDS })
      .populate({ path: 'classIds', select: ProjectsService.CLASS_FIELDS })
      .exec();

    if (!project) {
      throw new NotFoundException(`المشروع ذو المعرف ${id} غير موجود`);
    }

    const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
    const transformedProject = transformProjectResponse(project);

    if (transformedProject.files && transformedProject.files.length > 0) {
      transformedProject.files = transformedProject.files.map((file: any) => {
        const relativePath = `/uploads/projects/${transformedProject._id}/${file.filename}`;
        const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;
        return {
          ...file,
          url: fullUrl
        };
      });
    }

    return transformedProject;
  }

  async getMyProjects(studentId: string, filters: any = {}, pagination: PaginationDto = {}) {
    const student = await this.studentModel.findById(studentId);
    if (!student) {
      throw new NotFoundException(`الطالب غير موجود`);
    }

    const query: any = {};

    const now = new Date();
    if (filters.status === 'upcoming') query.dueDate = { $gt: now };
    else if (filters.status === 'overdue') query.dueDate = { $lt: now };

    if (filters.subjectId && mongoose.Types.ObjectId.isValid(filters.subjectId))
      query.subjectId = new mongoose.Types.ObjectId(filters.subjectId);
    if (filters.gradesCriteriaId && mongoose.Types.ObjectId.isValid(filters.gradesCriteriaId))
      query.gradesCriteriaId = new mongoose.Types.ObjectId(filters.gradesCriteriaId);
    if (filters.academicYear) query.academicYear = filters.academicYear;

    const total = await this.projectModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let projectsQuery = this.projectModel
      .find(query)
      .sort({ createdAt: -1 })
      .populate({ path: 'gradesCriteriaId', select: ProjectsService.GRADES_CRITERIA_FIELDS })
      .populate({ path: 'subjectId', select: ProjectsService.SUBJECT_FIELDS })
      .populate({ path: 'classIds', select: ProjectsService.CLASS_FIELDS });

    if (isPaginationRequested)
      projectsQuery = projectsQuery.skip(paginationMeta.skip).limit(paginationMeta.limit);

    const projects = await projectsQuery.exec();

    const projectIds = projects.map(p => p._id);
    const submissions = await this.submissionModel
      .find({ projectId: { $in: projectIds }, studentId })
      .select('projectId achievedGrade')
      .exec();
    const submissionMap = new Map(submissions.map(s => [s.projectId.toString(), s]));

    const data = projects.map(p => {
      const base = transformProjectResponse(p);
      const submission = submissionMap.get(p._id.toString());
      return {
        ...base,
        hasSubmitted: !!submission,
        achievedGrade: submission?.achievedGrade ?? null,
      };
    });

    if (isPaginationRequested) {
      return {
        message: 'تم استرجاع مشاريع الطالب بنجاح',
        data,
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages,
      };
    }

    return { message: 'تم استرجاع مشاريع الطالب بنجاح', data };
  }

  async getTeacherProjects(teacherId: string, filters: any = {}, pagination: PaginationDto = {}, req: any) {
    const query: any = { createdBy: teacherId };

    const now = new Date();
    if (filters.status === 'upcoming') query.dueDate = { $gt: now };
    else if (filters.status === 'overdue') query.dueDate = { $lt: now };

    if (filters.subjectId && mongoose.Types.ObjectId.isValid(filters.subjectId))
      query.subjectId = new mongoose.Types.ObjectId(filters.subjectId);
    if (filters.classIds && mongoose.Types.ObjectId.isValid(filters.classIds))
      query.classIds = { $in: [new mongoose.Types.ObjectId(filters.classIds)] };
    if (filters.academicYear) query.academicYear = filters.academicYear;

    const total = await this.projectModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let projectsQuery = this.projectModel
      .find(query)
      .sort({ createdAt: -1 })
      .populate({ path: 'gradesCriteriaId', select: ProjectsService.GRADES_CRITERIA_FIELDS })
      .populate({ path: 'subjectId', select: ProjectsService.SUBJECT_FIELDS })
      .populate({ path: 'classIds', select: ProjectsService.CLASS_FIELDS });

    if (isPaginationRequested)
      projectsQuery = projectsQuery.skip(paginationMeta.skip).limit(paginationMeta.limit);

    const projects = await projectsQuery.exec();
    const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    const data = projects.map(project => {
      const transformed = transformProjectResponse(project);
      if (transformed.files?.length > 0) {
        transformed.files = transformed.files.map((file: any) => ({
          ...file,
          url: `${baseUrl}/uploads/projects/${transformed._id}/${file.filename}`,
        }));
      }
      return transformed;
    });

    if (isPaginationRequested) {
      return { message: 'تم استرجاع مشاريع المعلم بنجاح', data, totalDocs: paginationMeta.total, totalPages: paginationMeta.totalPages };
    }
    return { message: 'تم استرجاع مشاريع المعلم بنجاح', data };
  }

  async filtering(filters: any, req: any, pagination: PaginationDto = {}, user?: any){
    const query: any = {};

    const textSearchFields = ['academicYear','title'];
    const arrayMatchFields = ['classIds'];
    const dataMatchFields = ['dueDate']
    const objectIdFields = ['gradesCriteriaId' , 'subjectId'];

    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      if (key === 'page' || key === 'limit') continue;

      const StringValue = String(value)

      if(textSearchFields.includes(key)){
        query[key] = { $regex: StringValue, $options: 'i' }
      }else if(arrayMatchFields.includes(key)){
          query[key] = { $in: [new mongoose.Types.ObjectId(StringValue)] };
      }else if (dataMatchFields.includes(key)){
        query[key] = new Date(String(StringValue));
      }else if(objectIdFields.includes(key)){
        query[key] = new mongoose.Types.ObjectId(StringValue);
      }
    }

    if(user?.role === 'TEACHER')
      query['createdBy'] = user.userId;

    const total = await this.projectModel.countDocuments(query).exec();
    const paginationMeta = getPagination(pagination.page, pagination.limit, total);
    const isPaginationRequested = pagination.page !== undefined || pagination.limit !== undefined;

    let projectsQuery = this.projectModel.find(query).sort({ createdAt: -1 })
      .populate({ path: 'gradesCriteriaId', select: ProjectsService.GRADES_CRITERIA_FIELDS })
      .populate({ path: 'subjectId', select: ProjectsService.SUBJECT_FIELDS })
      .populate({ path: 'classIds', select: ProjectsService.CLASS_FIELDS });

    if (isPaginationRequested) {
      projectsQuery = projectsQuery.skip(paginationMeta.skip).limit(paginationMeta.limit);
    }

    const projects = await projectsQuery.exec();

    const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
    console.log(baseUrl)

    const projectsWithUrls = projects.map(project => {
      const transformedProject = transformProjectResponse(project);
      if (transformedProject.files && transformedProject.files.length > 0) {
        transformedProject.files = transformedProject.files.map((file: any) => {
          const relativePath = `/uploads/projects/${transformedProject._id}/${file.filename}`;
          const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;
          return {
            ...file,
            url: fullUrl
          };
        });
      }
      return transformedProject;
    });

    if (isPaginationRequested) {
      return {
        data: projectsWithUrls,
        totalDocs: paginationMeta.total,
        totalPages: paginationMeta.totalPages
      };
    }

    return projectsWithUrls;
  }

  async downloadProjectFiles(projectId: string, user: any, res: Response): Promise<void> {
    const project = await this.projectModel.findById(projectId);

    if (!project) {
      throw new NotFoundException(`المشروع غير موجود`);
    }

    if (user?.role === 'STUDENT') {
      const student = await this.studentModel.findById(user.userId);
      if (!student) throw new NotFoundException(`الطالب غير موجود`);


    }

    const projectFolder = path.join('./uploads/projects', projectId);

    if (!fs.existsSync(projectFolder)) {
      throw new NotFoundException(`لا توجد ملفات لهذا المشروع`);
    }

    const files = fs.readdirSync(projectFolder);

    if (files.length === 0) {
      throw new NotFoundException(`لا توجد ملفات للمشروع ${projectId}`);
    }

    const archive = archiver('zip', { zlib: { level: 9 } });

    const sanitizedTitle = project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const zipFilename = `project_${sanitizedTitle}_${projectId}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);

    archive.pipe(res);
    archive.directory(projectFolder, false);
    archive.on('error', (err) => { throw err; });
    await archive.finalize();
  }

  async update(
    id: string,
    updateProjectDto: any,
    req: any,
    files?: Express.Multer.File[],
    user?: any,
  ): Promise<any> {
    const project = await this.projectModel.findById(id);

    if (!project) {
      throw new NotFoundException(`المشروع ذو المعرف ${id} غير موجود`);
    }

    if (user?.role === 'TEACHER') {
      if (project.createdBy?.toString() !== user.userId) {
        throw new ForbiddenException(
          'ليس لديك صلاحية لتحديث هذا المشروع. يمكنك فقط تحديث المشاريع التي قمت بإنشائها.',
        );
      }
    }

    if (updateProjectDto.classIds && updateProjectDto.subjectId && user?.role === 'TEACHER') {
      await this.verifyTeacherClassAccess(
        user.userId,
        updateProjectDto.classIds,
        updateProjectDto.subjectId,
      );
    }

    if (updateProjectDto.subjectId && updateProjectDto.academicYear) {
      const gradesCriteria = await this.gradesCriteriaModel.findOne({
        subjectId: updateProjectDto.subjectId,
        academicYear: updateProjectDto.academicYear,
      });

      if (!gradesCriteria) {
        throw new NotFoundException(
          `معايير التقييم غير موجودة للمادة ${updateProjectDto.subjectId} والعام الدراسي ${updateProjectDto.academicYear}`,
        );
      }

      updateProjectDto.gradesCriteriaId = gradesCriteria._id;
    }

    Object.assign(project, updateProjectDto);

    if (files && files.length > 0) {
      const projectFolder = path.join('./uploads/projects', id);

      if (!fs.existsSync(projectFolder)) {
        fs.mkdirSync(projectFolder, { recursive: true });
      }

      const newFiles = [];

      for (const file of files) {
        const newPath = path.join(projectFolder, file.filename);
        fs.renameSync(file.path, newPath);

        const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
        const relativePath = `/uploads/projects/${id}/${file.filename}`;
        const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;

        newFiles.push({
          filename: file.filename,
          originalName: file.originalname,
          path: newPath,
          url: fullUrl,
          size: file.size,
        });
      }

      project.files = [...(project.files || []), ...newFiles];
    }

    await project.save();

    const populatedProject = await this.projectModel
      .findById(id)
      .populate({ path: 'gradesCriteriaId', select: ProjectsService.GRADES_CRITERIA_FIELDS })
      .populate({ path: 'subjectId', select: ProjectsService.SUBJECT_FIELDS })
      .populate({ path: 'classIds', select: ProjectsService.CLASS_FIELDS })
      .exec();

    const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
    const transformedProject = transformProjectResponse(populatedProject);

    if (transformedProject.files && transformedProject.files.length > 0) {
      transformedProject.files = transformedProject.files.map((file: any) => {
        const relativePath = `/uploads/projects/${transformedProject._id}/${file.filename}`;
        const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;
        return {
          ...file,
          url: fullUrl
        };
      });
    }

    return transformedProject;
  }

  async delete(id: string, user?: any){
    const project = await this.projectModel.findById(id);
    if(!project){
      throw new NotFoundException(`المشروع ذو المعرف ${id} غير موجود`);
    }

    if (user?.role === 'TEACHER') {
      if (project.createdBy?.toString() !== user.userId) {
        throw new ForbiddenException(
          'ليس لديك صلاحية لحذف هذا المشروع. يمكنك فقط حذف المشاريع التي قمت بإنشائها.',
        );
      }
    }


    const projectFolder = path.join('./uploads/projects', id);
    if (fs.existsSync(projectFolder)) {
      fs.rmSync(projectFolder, { recursive: true, force: true });
    }

    await this.projectModel.findByIdAndDelete(id);

    return{
      message : 'تم حذف المشروع بنجاح',
      data : project,
    }
  }

  async addFiles(
    id: string,
    req: any,
    files?: Express.Multer.File[],
    user?: any,
  ): Promise<any> {
    const project = await this.projectModel.findById(id);
    if (!project) {
      throw new NotFoundException(`المشروع ذو المعرف ${id} غير موجود`);
    }

    if (user?.role === 'TEACHER') {
      if (project.createdBy?.toString() !== user.userId) {
        throw new ForbiddenException(
          'ليس لديك صلاحية لإضافة ملفات لهذا المشروع',
        );
      }
    }

    const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    if (!files || files.length === 0) {
      throw new NotFoundException('لم يتم توفير ملفات');
    }

    const projectFolder = path.join('./uploads/projects', id);

    if (!fs.existsSync(projectFolder)) {
      fs.mkdirSync(projectFolder, { recursive: true });
    }

    const existingFiles = project.files || [];

    for (const file of files) {
      const newPath = path.join(projectFolder, file.filename);

      fs.renameSync(file.path, newPath);

      existingFiles.push({
        filename: file.filename,
        originalName: file.originalname,
        path: newPath,
        size: file.size,
      });
    }

    project.files = existingFiles;
    await project.save();

    const updatedProject = await this.projectModel
      .findById(id)
      .populate({ path: 'gradesCriteriaId', select: ProjectsService.GRADES_CRITERIA_FIELDS })
      .populate({ path: 'subjectId', select: ProjectsService.SUBJECT_FIELDS })
      .populate({ path: 'classIds', select: ProjectsService.CLASS_FIELDS })
      .exec();

    const transformedProject = transformProjectResponse(updatedProject);

    if (transformedProject.files && transformedProject.files.length > 0) {
      transformedProject.files = transformedProject.files.map((file: any) => {
        const relativePath = `/uploads/projects/${transformedProject._id}/${file.filename}`;
        const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;
        return {
          ...file,
          url: fullUrl
        };
      });
    }

    return {
      message: 'تم إضافة الملفات بنجاح',
      data: transformedProject,
    };
  }

  async removeFile(id: string, filename: string, user?: any, req?: any): Promise<any> {
    const project = await this.projectModel.findById(id);
    if (!project) {
      throw new NotFoundException(`المشروع ذو المعرف ${id} غير موجود`);
    }

    if (user?.role === 'TEACHER') {
      if (project.createdBy?.toString() !== user.userId) {
        throw new ForbiddenException(
          'ليس لديك صلاحية لإزالة ملفات من هذا المشروع',
        );
      }
    }

    const fileIndex = project.files.findIndex(
      (file) => file.filename === filename,
    );

    if (fileIndex === -1) {
      throw new NotFoundException(`الملف ${filename} غير موجود في المشروع`);
    }

    const fileToRemove = project.files[fileIndex];
    const filePath = fileToRemove.path;

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    project.files.splice(fileIndex, 1);
    await project.save();

    const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    const updatedProject = await this.projectModel
      .findById(id)
      .populate({ path: 'gradesCriteriaId', select: ProjectsService.GRADES_CRITERIA_FIELDS })
      .populate({ path: 'subjectId', select: ProjectsService.SUBJECT_FIELDS })
      .populate({ path: 'classIds', select: ProjectsService.CLASS_FIELDS })
      .exec();

    const transformedProject = transformProjectResponse(updatedProject);

    if (transformedProject.files && transformedProject.files.length > 0) {
      transformedProject.files = transformedProject.files.map((file: any) => {
        const relativePath = `/uploads/projects/${transformedProject._id}/${file.filename}`;
        const fullUrl = baseUrl ? `${baseUrl}${relativePath}` : relativePath;
        return {
          ...file,
          url: fullUrl
        };
      });
    }

    return {
      message: `تم إزالة الملف ${filename} بنجاح`,
      data: transformedProject,
    };
  }
  async deleteAll(){
    this.projectModel.deleteMany().exec();
    return {
      message : 'تم حذف جميع المشاريع بنجاح',
    }
  }

  async listSubmissionsBySubjectAndClass(teacherId: string, subjectId: string, classId: string, req: any) {
    if (!mongoose.Types.ObjectId.isValid(subjectId)) throw new BadRequestException('صيغة معرف المادة غير صحيحة');
    if (!mongoose.Types.ObjectId.isValid(classId)) throw new BadRequestException('صيغة معرف الفصل غير صحيحة');

    const lecture = await this.lectureModel.findOne({
      teacherId: new mongoose.Types.ObjectId(teacherId),
      subjectId: new mongoose.Types.ObjectId(subjectId),
      classId: new mongoose.Types.ObjectId(classId),
    });
    if (!lecture) throw new ForbiddenException('لا تدرّس هذه المادة في هذا الفصل');

    const projects = await this.projectModel
      .find({ subjectId: new mongoose.Types.ObjectId(subjectId), classIds: { $in: [new mongoose.Types.ObjectId(classId)] } })
      .select('_id title dueDate grade')
      .exec();

    const projectIds = projects.map(p => p._id);

    const submissions = await this.submissionModel
      .find({ projectId: { $in: projectIds } })
      .populate({ path: 'studentId', select: 'name schoolEmail' })
      .populate({ path: 'projectId', select: 'title dueDate grade' })
      .exec();

    const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';

    return {
      message: 'تم استرجاع التقديمات بنجاح',
      data: submissions.map(s => this.formatSubmission(s, baseUrl)),
    };
  }

  // ─── Student Submission Methods ───────────────────────────────────────────

  private buildSubmissionFileUrl(baseUrl: string, projectId: string, studentId: string, filename: string) {
    const rel = `/uploads/submissions/${projectId}/${studentId}/${filename}`;
    return baseUrl ? `${baseUrl}${rel}` : rel;
  }

  private formatSubmission(sub: any, baseUrl: string) {
    const s = sub.toObject ? sub.toObject() : sub;
    return {
      ...s,
      files: (s.files || []).map((f: any) => ({
        ...f,
        url: this.buildSubmissionFileUrl(baseUrl, s.projectId.toString(), s.studentId.toString(), f.filename),
      })),
    };
  }

  async submitFiles(projectId: string, studentId: string, files: Express.Multer.File[], req: any) {
    const project = await this.projectModel.findById(projectId);
    if (!project) throw new NotFoundException(`المشروع غير موجود`);

    const student = await this.studentModel.findById(studentId);
    if (!student) throw new NotFoundException(`الطالب غير موجود`);



    if (new Date() > (project as any).dueDate) {
      throw new BadRequestException('انتهى الوقت المحدد لتسليم هذا المشروع');
    }

    if (!files || files.length === 0) throw new BadRequestException('لم يتم توفير ملفات');

    const folder = path.join('./uploads/submissions', projectId, studentId);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

    let submission = await this.submissionModel.findOne({ projectId, studentId });
    if (!submission) {
      submission = await this.submissionModel.create({ projectId, studentId, files: [], maxGrade: project.grade });
    }

    const existingFiles: typeof submission.files = [...(submission.files || [])];
    for (const file of files) {
      const dest = path.join(folder, file.filename);
      fs.renameSync(file.path, dest);
      // replace existing entry with same filename instead of duplicating
      const existingIdx = existingFiles.findIndex(f => f.filename === file.filename);
      const entry = { filename: file.filename, originalName: file.originalname, path: dest, size: file.size };
      if (existingIdx !== -1) existingFiles[existingIdx] = entry;
      else existingFiles.push(entry);
    }
    submission.files = existingFiles;
    await submission.save();

    const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
    return { message: 'تم رفع الملفات بنجاح', data: this.formatSubmission(submission, baseUrl) };
  }

  async deleteSubmissionFile(projectId: string, studentId: string, filename: string) {
    const submission = await this.submissionModel.findOne({ projectId, studentId });
    if (!submission) throw new NotFoundException('لا يوجد تقديم لهذا الطالب');

    const idx = submission.files.findIndex(f => f.filename === filename);
    if (idx === -1) throw new NotFoundException(`الملف ${filename} غير موجود`);

    const filePath = submission.files[idx].path;
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    submission.files.splice(idx, 1);
    await submission.save();

    return { message: `تم حذف الملف ${filename} بنجاح` };
  }

  async getMySubmission(projectId: string, studentId: string, req: any) {
    const submission = await this.submissionModel.findOne({ projectId, studentId });
    if (!submission) return { message: 'لم تقم بتقديم هذا المشروع بعد', data: null };

    const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
    return { message: 'تم استرجاع تقديمك بنجاح', data: this.formatSubmission(submission, baseUrl) };
  }

  async listSubmissions(projectId: string, user: any, req: any) {
    const project = await this.projectModel.findById(projectId);
    if (!project) throw new NotFoundException(`المشروع غير موجود`);

    if (user?.role === 'TEACHER') {
      const lecture = await this.lectureModel.findOne({
        teacherId: new mongoose.Types.ObjectId(user.userId),
        subjectId: project.subjectId,
        classId: { $in: project.classIds },
      });
      if (!lecture) throw new ForbiddenException('ليس لديك صلاحية لعرض تقديمات هذا المشروع');
    }

    const submissions = await this.submissionModel
      .find({ projectId })
      .populate({ path: 'studentId', select: 'name schoolEmail' })
      .exec();

    const baseUrl = req?.protocol && req?.host ? `${req.protocol}://${req.host}` : '';
    return {
      message: 'تم استرجاع التقديمات بنجاح',
      data: submissions.map(s => this.formatSubmission(s, baseUrl)),
    };
  }

  async downloadSubmission(projectId: string, studentId: string, user: any, res: Response) {
    const project = await this.projectModel.findById(projectId);
    if (!project) throw new NotFoundException(`المشروع غير موجود`);

    if (user?.role === 'TEACHER') {
      const lecture = await this.lectureModel.findOne({
        teacherId: new mongoose.Types.ObjectId(user.userId),
        subjectId: project.subjectId,
        classId: { $in: project.classIds },
      });
      if (!lecture) throw new ForbiddenException('ليس لديك صلاحية لتنزيل هذا التقديم');
    }

    const submission = await this.submissionModel.findOne({ projectId, studentId });
    if (!submission || submission.files.length === 0) {
      throw new NotFoundException('لا توجد ملفات لهذا التقديم');
    }

    const folder = path.join('./uploads/submissions', projectId, studentId);
    if (!fs.existsSync(folder)) throw new NotFoundException('مجلد التقديم غير موجود');

    const archive = archiver('zip', { zlib: { level: 9 } });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="submission_${studentId}.zip"`);
    archive.pipe(res);
    archive.directory(folder, false);
    archive.on('error', (err) => { throw err; });
    await archive.finalize();
  }

  async gradeSubmission(projectId: string, studentId: string, achievedGrade: number, teacher: any) {
    const project = await this.projectModel.findById(projectId);
    if (!project) throw new NotFoundException(`المشروع غير موجود`);

    const student = await this.studentModel.findById(studentId);
    if (!student) throw new NotFoundException(`الطالب غير موجود`);

    const lecture = await this.lectureModel.findOne({
      teacherId: new mongoose.Types.ObjectId(teacher.userId),
      subjectOfferingId: project.subjectId,
    });
    if (!lecture) throw new ForbiddenException('ليس لديك صلاحية لتقييم هذا الطالب في هذه المادة');

    if (achievedGrade < 0 || achievedGrade > project.grade) {
      throw new BadRequestException(`الدرجة يجب أن تكون بين 0 و ${project.grade}`);
    }

    const submission = await this.submissionModel.findOneAndUpdate(
      { projectId, studentId },
      { achievedGrade, maxGrade: project.grade, gradedBy: teacher.userId, gradedAt: new Date() },
      { new: true, upsert: false },
    );
    if (!submission) throw new NotFoundException('لا يوجد تقديم لهذا الطالب');

    return {
      message: 'تم تقييم التقديم بنجاح',
      data: { studentId, projectId, achievedGrade, maxGrade: project.grade, gradedAt: submission.gradedAt },
    };
  }
}
