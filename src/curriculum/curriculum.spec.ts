import { NotFoundException } from '@nestjs/common';
import { CurriculumService } from './curriculum.service';

describe('Curriculum bulk lesson entry', () => {
  let service: CurriculumService;
  let stored: any[];
  let createLesson: jest.SpyInstance;

  beforeEach(() => {
    service = new CurriculumService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    stored = [{ _id: 'existing', name: 'درس سابق', order: 4 }];

    jest
      .spyOn(service, 'listLessons')
      .mockImplementation(async () => stored as any);
    createLesson = jest
      .spyOn(service, 'createLesson')
      .mockImplementation(async (unitId, dto) => {
        const lesson = {
          _id: `lesson-${stored.length}`,
          unitId,
          ...dto,
        };
        stored.push(lesson);
        return lesson as any;
      });
  });

  it('creates three lessons after the unit current maximum order', async () => {
    const result = await service.createLessonsBulk('unit', {
      names: ['الأول', 'الثاني', 'الثالث'],
    });

    expect(result.data.created).toBe(3);
    expect(result.data.skipped).toBe(0);
    expect(result.data.lessons.map((lesson: any) => lesson.order)).toEqual([
      5, 6, 7,
    ]);
  });

  it('skips every lesson when the same list is posted again', async () => {
    const dto = { names: ['الأول', 'الثاني', 'الثالث'] };
    await service.createLessonsBulk('unit', dto);
    const result = await service.createLessonsBulk('unit', dto);

    expect(result.data.created).toBe(0);
    expect(result.data.skipped).toBe(3);
  });

  it('creates only two names added to a previously posted list', async () => {
    await service.createLessonsBulk('unit', {
      names: ['الأول', 'الثاني', 'الثالث'],
    });
    const result = await service.createLessonsBulk('unit', {
      names: ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس'],
    });

    expect(result.data.created).toBe(2);
    expect(result.data.skipped).toBe(3);
    expect(result.data.lessons.map((lesson: any) => lesson.name)).toEqual([
      'الرابع',
      'الخامس',
    ]);
  });

  it('removes a leading list number and a trailing dotted page number', async () => {
    const result = await service.createLessonsBulk('unit', {
      names: ['1. جمع الكسور ...... 58'],
    });

    expect(result.data.lessons[0].name).toBe('جمع الكسور');
  });

  it('drops blank and whitespace-only lines', async () => {
    const result = await service.createLessonsBulk('unit', {
      names: ['الأول', '', '   ', '\t\n'],
    });

    expect(result.data.created).toBe(1);
    expect(createLesson).toHaveBeenCalledTimes(1);
    expect(stored.some((lesson) => lesson.name === '')).toBe(false);
  });

  it('previews cleaned names and counts without writing on a dry run', async () => {
    const result = await service.createLessonsBulk('unit', {
      names: ['١- الأول ... ٥٨', '  •  الثاني   الممتد  ', 'درس سابق'],
      dryRun: true,
    });

    expect(result.data.created).toBe(2);
    expect(result.data.skipped).toBe(1);
    expect(result.data.names).toEqual(['الأول', 'الثاني الممتد', 'درس سابق']);
    expect(result.data.lessons).toEqual([
      { name: 'الأول', order: 5 },
      { name: 'الثاني الممتد', order: 6 },
    ]);
    expect(createLesson).not.toHaveBeenCalled();
    expect(stored).toHaveLength(1);
  });

  it('rejects a unit that is outside the current school', async () => {
    jest
      .spyOn(service, 'listLessons')
      .mockRejectedValueOnce(new NotFoundException('الوحدة غير موجودة'));

    await expect(
      service.createLessonsBulk('other-school-unit', { names: ['الأول'] }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(createLesson).not.toHaveBeenCalled();
  });
});
