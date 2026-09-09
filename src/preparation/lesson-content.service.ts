import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { createHmac } from 'crypto';
import { Preparation } from './schemas/preparation.schema';
import { GeneratePreparationDto } from './dto/generate-preparation.dto';
import { RESOURCE_TYPES } from './schemas/preparation-resource.schema';
import { ExamsService } from '../exams/exams.service';
import { PreparationResource } from './schemas/preparation-resource.schema';
import { Library } from '../library/schemas/library.schema';
import { CurriculumLesson } from '../curriculum/schemas/curriculum-lesson.schema';
import { CurriculumUnit } from '../curriculum/schemas/curriculum-unit.schema';
import { SubjectOffering } from '../subject-offerings/schemas/subject-offering.schema';

/** What the workflow is asked to write, and where each answer lands. */
const TEXT_FIELDS = [
  'warmUp',
  'closure',
  'vocabulary',
  'thinkingSkills',
  'teacherInstructions',
] as const;

const LIST_FIELDS = ['objectives', 'teachingStrategies', 'teachingAids'] as const;

/**
 * Filling a preparation's content from the school's own workflow.
 *
 * A teacher picking a lesson gets its name and the objectives the school wrote
 * on it. Everything else — the warm-up, the closure, the vocabulary, the
 * thinking skills, the note to herself — is still a blank page, and a blank
 * page is why teachers upload a PDF instead.
 *
 * ## Why an outbound webhook rather than a model call here
 *
 * Same reason as the WhatsApp messages: the wording, the model and the prompt
 * are the school's to change, and every change would otherwise be a deploy.
 * Nasaq sends the facts about the lesson and receives written content back.
 *
 * ## What it will not do
 *
 * **It never overwrites what the teacher wrote.** A field already holding text
 * is left exactly as it is; only blanks are filled. Generated content that can
 * quietly replace a teacher's own sentence is worse than no generated content,
 * and this is the rule that makes the feature safe to run twice.
 */
@Injectable()
export class LessonContentService implements OnModuleInit {
  private readonly logger = new Logger(LessonContentService.name);
  private static readonly TIMEOUT_MS = 90_000;

  constructor(
    @InjectModel(Preparation.name)
    private readonly preparations: Model<Preparation>,
    @InjectModel(CurriculumLesson.name)
    private readonly lessons: Model<CurriculumLesson>,
    @InjectModel(CurriculumUnit.name)
    private readonly units: Model<CurriculumUnit>,
    @InjectModel(SubjectOffering.name)
    private readonly offerings: Model<SubjectOffering>,
    @InjectModel(PreparationResource.name)
    private readonly resources: Model<PreparationResource>,
    @InjectModel(Library.name)
    private readonly library: Model<Library>,
    private readonly exams?: ExamsService,
  ) {}

  private get webhookUrl(): string {
    return (process.env.AI_WEBHOOK_URL ?? '').trim();
  }
  private get secret(): string {
    return (process.env.AI_WEBHOOK_SECRET ?? '').trim();
  }
  private get enabled(): boolean {
    return (process.env.AI_ENABLED ?? 'true').toLowerCase() !== 'false';
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('Lesson content generation is off (AI_ENABLED=false).');
      return;
    }
    if (!this.webhookUrl) {
      this.logger.warn(
        'AI_WEBHOOK_URL is not set — POST /preparation/:id/generate will answer that it is unavailable.',
      );
      return;
    }
    if (!this.secret) {
      this.logger.warn(
        'AI_WEBHOOK_SECRET is not set — the request body will be unsigned.',
      );
    }
  }

  sign(body: string): string {
    return 'sha256=' + createHmac('sha256', this.secret).update(body, 'utf8').digest('hex');
  }

  /**
   * Fill the empty content fields of one preparation.
   *
   * Synchronous on purpose: somebody pressed a button and is waiting for the
   * page to fill in. A caller preparing a whole week loops over this and shows
   * progress, so one lesson that fails is one row that failed.
   */
  async generate(id: string, user: any, options: GeneratePreparationDto = {}) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('معرّف غير صالح');
    }
    if (!this.enabled || !this.webhookUrl) {
      throw new BadRequestException(
        'توليد محتوى التحضير غير مفعّل على هذا الخادم.',
      );
    }

    const prep = await this.preparations.findById(id).exec();
    if (!prep) throw new NotFoundException('التحضير غير موجود');
    if (
      user?.role === 'STUDENT' ||
      (user?.role === 'TEACHER' &&
        String(prep.submittedBy ?? '') !== String(user?.userId ?? ''))
    ) {
      throw new ForbiddenException('ليس مسموحاً لك بتعديل هذا التحضير');
    }

    if (!['draft', 'needs_revision'].includes(prep.reviewStatus)) {
      throw new BadRequestException('التوليد متاح للمسودة أو التحضير المطلوب تعديله فقط');
    }
    const includeContent = options.includeContent !== false;
    const explicit = options.resourceTypes !== undefined;
    if (explicit && (!Array.isArray(options.resourceTypes) ||
        options.resourceTypes.some((type) => !RESOURCE_TYPES.includes(type)))) {
      throw new BadRequestException('نوع الإضافة غير صالح');
    }
    // Older clients asked for homework only when there were no assignments at all.
    const requested = explicit ? [...new Set(options.resourceTypes)] :
      (await this.resources.exists({ preparationId: prep._id })) ? [] : ['homework'];
    const resourceResults: { type: string; status: string; message?: string; examId?: string }[] = [];
    const missing: string[] = [];
    for (const type of requested) {
      if (await this.resources.exists({ preparationId: prep._id, type, ...(type === 'quiz' ? { examId: { $ne: null } } : {}) }))
        resourceResults.push({ type, status: 'existing' });
      else missing.push(type);
    }
    if (missing.includes('quiz')) {
      if (user?.role !== 'TEACHER' || !Array.isArray(user.permissions) ||
          !['*', 'school.exams.create', 'school.exams.manage'].some((p) => user.permissions.includes(p))) {
        throw new ForbiddenException('إنشاء الامتحان يتطلب حساب معلم وصلاحية إنشاء الامتحانات');
      }
      const exam = options.exam;
      const validDate = (value: unknown): value is string => typeof value === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value;
      if (!exam || !prep.classId || !prep.subject || !this.exams ||
          !['quiz', 'final', 'assignment', 'activity'].includes(exam.examType) ||
          !Number.isInteger(exam.duration) || exam.duration < 1 || exam.duration > 240 ||
          !Number.isInteger(exam.questionCount) || exam.questionCount < 1 || exam.questionCount > 20 ||
          !validDate(exam.startDate) || !validDate(exam.endDate) || exam.endDate < exam.startDate) {
        throw new BadRequestException('حدد نوع الامتحان وتواريخ صحيحة والمدة (١–٢٤٠ دقيقة) وعدد الأسئلة (١–٢٠)، وتأكد من فصل ومادة الحصة');
      }
    }
    const context = await this.describe(prep);
    if (!context.lessonTitle) {
      throw new BadRequestException('اختر درسًا من المنهج أولًا — التوليد يحتاج اسم الدرس.');
    }
    const generated = includeContent || missing.length
      ? await this.ask({ ...context, resourceTypes: missing, includeContent,
          ...(missing.includes('quiz') ? { exam: options.exam } : {}) }) : {};
    const changes = includeContent ? this.onlyBlanks(prep, generated) : {};
    const attached = includeContent ? await this.attachDigitalContent(prep, changes) : 0;
    const additions: { type: string; title: string; description: string }[] = [];
    for (const type of missing) {
      // A manual addition created while the model worked always takes precedence.
      if (await this.resources.exists({ preparationId: prep._id, type, ...(type === 'quiz' ? { examId: { $ne: null } } : {}) })) {
        resourceResults.push({ type, status: 'existing' });
        continue;
      }
      const resource = Array.isArray(generated.resources)
        ? generated.resources.find((item: any) => item?.type === type)
        : type === 'homework' ? generated.homework : null;
      const title = typeof resource?.title === 'string' ? resource.title.trim() : '';
      const description = typeof resource?.description === 'string' ? resource.description.trim() : '';
      if (!title || !description || title.length > 300 || description.length > 10000) {
        resourceResults.push({ type, status: 'failed', message: 'لم تُرجع خدمة التوليد محتوى صالحًا لهذه الإضافة. حدّث سير عمل التوليد ثم أعد المحاولة.' });
        continue;
      }
      additions.push({ type, title, description });
    }
    let updated: any = prep;
    if (Object.keys(changes).length || additions.length) {
      // Reject stale model output rather than overwrite content written during generation.
      updated = await this.preparations.findOneAndUpdate({
        _id: prep._id,
        reviewStatus: { $in: ['draft', 'needs_revision'] },
        $or: [{ contentRevision: prep.contentRevision ?? 0 },
          ...(prep.contentRevision ? [] : [{ contentRevision: { $exists: false } }])],
      }, { $set: changes, $inc: { contentRevision: 1 } }, { new: true }).exec();
      if (!updated) throw new ConflictException('تم تعديل التحضير أثناء التوليد. حدّث الأسبوع وأعد المحاولة.');
    }
    for (const addition of additions) {
      let examId: string | undefined;
      if (addition.type === 'quiz') {
        try {
          const questions = generated.exam?.questions;
          if (!Array.isArray(questions) || questions.length !== options.exam.questionCount ||
              questions.some((q: any) => typeof q?.question !== 'string' || !q.question.trim() ||
                q.question.length > 2000 || !Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6 ||
                q.options.some((option: any) => typeof option !== 'string' || !option.trim() || option.length > 1000) ||
                new Set(q.options).size !== q.options.length || !q.options.includes(q.correctAnswer))) {
            throw new BadRequestException('لم تُرجع خدمة التوليد أسئلة امتحان صالحة بالعدد المطلوب');
          }
          const startDate = new Date(options.exam.startDate); startDate.setHours(0, 0, 0, 0);
          const endDate = new Date(options.exam.endDate); endDate.setHours(23, 59, 59, 999);
          const exam: any = await this.exams.create({
            subjectOfferingId: String(prep.subject), classIds: [String(prep.classId)],
            examType: options.exam.examType, duration: options.exam.duration, startDate, endDate,
            questions: questions.map((q: any) => ({ question: q.question, options: q.options, correctAnswer: q.correctAnswer })),
          }, user, String(prep._id));
          examId = String(exam._id ?? exam.id ?? '');
          if (!Types.ObjectId.isValid(examId)) throw new Error('Invalid generated exam response');
        } catch (error: any) {
          if (typeof error?.getStatus !== 'function' || error.getStatus() >= 500) throw error;
          resourceResults.push({ type: 'quiz', status: 'failed', message: error.message });
          continue;
        }
      }
      try {
        const saved = await this.resources.updateOne({
          preparationId: prep._id, generationKey: addition.type,
        }, { $setOnInsert: { ...addition, ...(examId ? { examId } : {}), preparationId: prep._id, generationKey: addition.type } },
        { upsert: true, runValidators: true }).exec();
        resourceResults.push({ type: addition.type, status: saved.upsertedCount ? 'created' : 'existing', ...(examId ? { examId } : {}) });
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
        resourceResults.push({ type: addition.type, status: 'existing' });
      }
    }
    const added = resourceResults.filter((row) => row.status === 'created');
    if (added.length) {
      // A concurrent submit cannot leave newly added resources marked reviewed.
      updated = await this.preparations.findByIdAndUpdate(prep._id, {
        $set: { reviewStatus: 'draft', reviewedBy: null, reviewedByName: '', reviewedAt: null, reviewNote: '' },
        $inc: { contentRevision: 1 },
      }, { new: true }).exec();
    }
    return {
      message: resourceResults.some((row) => row.status === 'failed')
        ? 'حُفظ المحتوى المتاح، وتعذر توليد بعض الإضافات'
        : `تم توليد ${Object.keys(changes).length} حقلًا وإضافة ${added.length} تكليف`,
      data: { id, filled: Object.keys(changes), attachedContent: attached,
        homeworkAdded: added.some((row) => row.type === 'homework'),
        resourceResults, preparation: updated },
    };
  }

  /**
   * Attach a library item, when one actually fits.
   *
   * Submission requires digital content that belongs to the lecture's own
   * subject and grade — or is school-wide. Anything else is refused by
   * `validateReferences`, so this picks from exactly those two sets and
   * attaches nothing when neither has a member. A wrong video attached
   * silently is worse than a bullet telling the teacher to choose one.
   */
  private async attachDigitalContent(
    prep: any,
    changes: Record<string, any>,
  ): Promise<number> {
    if (prep.digitalContentIds?.length) return 0;

    const offering: any = await this.offerings.findById(prep.subject).lean().exec();
    if (!offering) return 0;

    const siblings = await this.offerings
      .find({
        subjectId: offering.subjectId,
        gradeLevelId: offering.gradeLevelId,
      })
      .select('_id')
      .lean()
      .exec();

    const item = await this.library
      .findOne({
        $or: [
          { subjectOfferingId: { $in: siblings.map((s: any) => s._id) } },
          { subjectOfferingId: null },
          { subjectOfferingId: { $exists: false } },
        ],
      })
      .select('_id')
      .lean()
      .exec();

    if (!item) return 0;
    changes.digitalContentIds = [item._id];
    return 1;
  }

  /** Everything the workflow needs to write about this lesson. */
  private async describe(prep: any) {
    const lesson = prep.lessonId
      ? await this.lessons.findById(prep.lessonId).lean().exec()
      : null;
    const unit = lesson?.unitId
      ? await this.units.findById(lesson.unitId).lean().exec()
      : null;

    const offering: any = await this.offerings
      .findById(prep.subject)
      .populate('subjectId', 'subjectName')
      .populate('gradeLevelId', 'name')
      .lean()
      .exec();

    return {
      lessonTitle: String(lesson?.name ?? prep.lessonTitle ?? '').trim(),
      unit: String((unit as any)?.name ?? '').trim(),
      subject: String(offering?.subjectId?.subjectName ?? '').trim(),
      grade: String(offering?.gradeLevelId?.name ?? '').trim(),
      // The school's own objectives, when it wrote any: content written around
      // them beats content written around a title.
      objectives: Array.isArray(lesson?.objectives) ? lesson.objectives : [],
    };
  }

  private async ask(context: Record<string, any>) {
    const body = JSON.stringify({
      event: 'preparation.generate',
      occurredAt: new Date().toISOString(),
      ...context,
    });

    let response: Response;
    try {
      response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Nasaq-Event': 'preparation.generate',
          ...(this.secret ? { 'X-Nasaq-Signature': this.sign(body) } : {}),
        },
        body,
        signal: AbortSignal.timeout(LessonContentService.TIMEOUT_MS),
      });
    } catch (error: any) {
      const timedOut =
        error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new BadRequestException(
        timedOut
          ? 'استغرق توليد المحتوى وقتًا أطول من اللازم — حاول مرة أخرى'
          : 'تعذر الوصول إلى خدمة توليد المحتوى',
      );
    }

    if (!response.ok) {
      const text = (await response.text().catch(() => '')).slice(0, 200);
      this.logger.error(`Generation webhook failed: ${response.status} ${text}`);
      throw new BadRequestException('تعذر توليد المحتوى — راجع إعدادات الخدمة');
    }

    /*
     * A workflow that throws before it reaches its Respond node still answers
     * 200, with an empty body or with n8n's own `{ message }` envelope — from
     * out here a broken Code node looks exactly like a success. Read the body
     * as text first so the log can say which, instead of leaving a bare
     * "unreadable reply" as the only trace of a `TextEncoder is not defined`.
     */
    const text = await response.text().catch(() => '');
    let payload: any = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    // n8n hands back either the object or a one-element array of it.
    const data = Array.isArray(payload) ? payload[0] : payload;
    const content = data && typeof data === 'object' ? (data.data ?? data) : null;

    // Content is content only if it carries a field we asked for. An n8n
    // error envelope carries none, and neither does an empty body.
    const answered =
      content &&
      typeof content === 'object' &&
      [...TEXT_FIELDS, ...LIST_FIELDS, 'resources', 'homework', 'exam'].some(
        (field) => content[field] !== undefined,
      );

    if (!answered) {
      this.logger.error(
        `Generation webhook returned no usable content: HTTP ${response.status} ` +
          (text ? text.slice(0, 300) : '(empty body)'),
      );
      throw new BadRequestException(
        'سير عمل التوليد لم يُرجع محتوى — راجع آخر تنفيذ في n8n',
      );
    }

    return content;
  }

  /**
   * The changes to apply: generated values for fields that are empty, and
   * nothing else.
   */
  private onlyBlanks(prep: any, generated: any): Record<string, any> {
    const changes: Record<string, any> = {};

    for (const field of TEXT_FIELDS) {
      const existing = String(prep[field] ?? '').trim();
      const incoming = String(generated?.[field] ?? '').trim();
      if (!existing && incoming) changes[field] = incoming;
    }

    for (const field of LIST_FIELDS) {
      const existing = Array.isArray(prep[field])
        ? prep[field].map((v: any) => String(v).trim()).filter(Boolean)
        : [];
      if (existing.length) continue;

      const incoming = Array.isArray(generated?.[field])
        ? generated[field].map((v: any) => String(v ?? '').trim()).filter(Boolean)
        : [];
      // Cap it: a workflow returning fifty objectives is a prompt that got
      // away, not a lesson plan.
      if (incoming.length) changes[field] = incoming.slice(0, 12);
    }

    return changes;
  }
}
