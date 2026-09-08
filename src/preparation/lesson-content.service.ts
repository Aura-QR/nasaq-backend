import {
  BadRequestException,
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
  async generate(id: string, user: any) {
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

    const context = await this.describe(prep);
    if (!context.lessonTitle) {
      // Without a lesson there is nothing to write about, and a warm-up
      // generated from a subject name alone is filler.
      throw new BadRequestException(
        'اختر درسًا من المنهج أولًا — التوليد يحتاج اسم الدرس.',
      );
    }

    const generated = await this.ask(context);
    const changes = this.onlyBlanks(prep, generated);

    /*
     * The three other things a preparation needs before it can be sent.
     *
     * Filling the prose and leaving these empty produces a draft that still
     * cannot be submitted — 'لا يمكن الإرسال' with three bullets — which is
     * exactly the wall this feature exists to remove. Each is attached only
     * when the teacher has not already made the choice herself.
     */
    const attached = await this.attachDigitalContent(prep, changes);
    const homework = await this.attachHomework(prep, generated);

    if (!Object.keys(changes).length && !homework) {
      return {
        message: 'كل الحقول مكتوبة بالفعل — لم يتم تغيير شيء',
        data: { id, filled: [], attachedContent: 0, homeworkAdded: false },
      };
    }

    const updated = Object.keys(changes).length
      ? await this.preparations
          .findByIdAndUpdate(
            id,
            { $set: changes, $inc: { contentRevision: 1 } },
            { new: true },
          )
          .exec()
      : await this.preparations.findById(id).exec();

    return {
      message: `تم توليد ${Object.keys(changes).length} حقلًا`,
      data: {
        id,
        filled: Object.keys(changes),
        attachedContent: attached,
        homeworkAdded: homework,
        preparation: updated,
      },
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

  /**
   * Add the homework the workflow wrote, when the teacher has filed nothing.
   *
   * Submission needs at least one assignment. The title comes from the model
   * — a homework about this lesson — rather than the literal word "واجب",
   * because a teacher reviewing twenty-two of those learns to ignore them.
   */
  private async attachHomework(prep: any, generated: any): Promise<boolean> {
    if (await this.resources.exists({ preparationId: prep._id })) return false;

    const title = String(generated?.homework?.title ?? '').trim();
    if (!title) return false;

    await this.resources.create({
      preparationId: prep._id,
      type: 'homework',
      title: title.slice(0, 300),
      description: String(generated?.homework?.description ?? '').trim().slice(0, 10000),
    });
    return true;
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

    const payload = await response.json().catch(() => null);
    // n8n hands back either the object or a one-element array of it.
    const data = Array.isArray(payload) ? payload[0] : payload;
    if (!data || typeof data !== 'object') {
      throw new BadRequestException('رد غير مفهوم من خدمة توليد المحتوى');
    }
    return (data as any).data ?? data;
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
