import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ExamsService } from './exams.service';

/**
 * Reading back your own exam result.
 *
 * The student app asked for GET /exams/:examId/grade — a route that did not
 * exist — and swallowed the 404, so a finished exam showed no mark at all.
 * These cover the route's answer rather than its address: an old row that
 * kept no answers still has to report a score, and a paper that was started
 * but never handed in is not a result.
 */
describe('ExamsService.getMyResult', () => {
  const examId = new Types.ObjectId();
  const studentId = new Types.ObjectId();
  const user = { role: 'STUDENT', userId: String(studentId) };

  const questions = [{}, {}, {}, {}]; // four questions, contents irrelevant

  const build = (result: any, exam: any = { _id: examId, examType: 'quiz', grade: 20, questions }) => {
    const examModel = { findById: () => ({ select: () => ({ exec: async () => exam }) }) };
    const examResultModel = { findOne: () => ({ exec: async () => result }) };
    return new ExamsService(
      examModel as any, null as any, null as any, null as any, null as any,
      examResultModel as any, null as any, null as any, null as any,
    );
  };

  it('returns the stored score with the answer breakdown', async () => {
    const answers = [
      { questionId: 'q1', studentAnswer: '٢', correctAnswer: '٢', isCorrect: true },
      { questionId: 'q2', studentAnswer: '٣', correctAnswer: '٤', isCorrect: false },
      { questionId: 'q3', studentAnswer: '١', correctAnswer: '١', isCorrect: true },
      { questionId: 'q4', studentAnswer: '٥', correctAnswer: '١', isCorrect: false },
    ];
    const service = build({ submitted: true, achievedGrade: 10, percentage: 50, passed: true, answers });

    const { data } = await service.getMyResult(String(examId), user);

    expect(data.totalQuestions).toBe(4);
    expect(data.correctAnswers).toBe(2);
    expect(data.incorrectAnswers).toBe(2);
    expect(data.achievedGrade).toBe(10);
    expect(data.results).toHaveLength(4);
  });

  it('still counts a result written before answers were kept', async () => {
    const service = build({ submitted: true, achievedGrade: 15, percentage: 75, passed: true, answers: [] });

    const { data } = await service.getMyResult(String(examId), user);

    // 75% of four questions — recovered from the percentage, not the answers.
    expect(data.correctAnswers).toBe(3);
    expect(data.results).toEqual([]);
    expect(data.achievedGrade).toBe(15);
  });

  it('refuses a paper that was started and never handed in', async () => {
    const service = build({ submitted: false, answers: [] });

    await expect(service.getMyResult(String(examId), user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses an exam the student never sat', async () => {
    const service = build(null);

    await expect(service.getMyResult(String(examId), user)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an exam that does not exist', async () => {
    const service = build({ submitted: true, answers: [] }, null);

    await expect(service.getMyResult(String(examId), user)).rejects.toBeInstanceOf(NotFoundException);
  });
});
