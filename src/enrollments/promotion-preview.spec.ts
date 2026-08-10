import { GradesCriteriaService } from '../grades-criteria/grades-criteria.service';
import * as mongoose from 'mongoose';

describe('Promotion Preview Automatic Pass/Fail Calculation Unit Tests', () => {
  it('should calculate subject results and overallPassed correctly for Ahmed, Sara, and Mohamed', async () => {
    const mathId = new mongoose.Types.ObjectId().toString();
    const arabicId = new mongoose.Types.ObjectId().toString();
    const csId = new mongoose.Types.ObjectId().toString();
    const artId = new mongoose.Types.ObjectId().toString();

    // Mock subject definitions
    const mathSubject = {
      _id: mathId,
      subjectName: 'Math',
      isRequiredForPromotion: true,
    };
    const arabicSubject = {
      _id: arabicId,
      subjectName: 'Arabic',
      isRequiredForPromotion: true,
    };
    const csSubject = {
      _id: csId,
      subjectName: 'Computer Studies',
      isRequiredForPromotion: true,
    };
    const artSubject = {
      _id: artId,
      subjectName: 'Art',
      isRequiredForPromotion: false, // Elective
    };

    // Terms
    const term1 = { _id: new mongoose.Types.ObjectId().toString(), order: 1 };
    const term2 = { _id: new mongoose.Types.ObjectId().toString(), order: 2 };
    const term3 = { _id: new mongoose.Types.ObjectId().toString(), order: 3 };

    // Offerings
    const mathOfferings = [
      { _id: new mongoose.Types.ObjectId().toString(), subjectId: mathSubject, termId: term1._id },
      { _id: new mongoose.Types.ObjectId().toString(), subjectId: mathSubject, termId: term2._id },
      { _id: new mongoose.Types.ObjectId().toString(), subjectId: mathSubject, termId: term3._id },
    ];
    const arabicOfferings = [
      { _id: new mongoose.Types.ObjectId().toString(), subjectId: arabicSubject, termId: term1._id },
      { _id: new mongoose.Types.ObjectId().toString(), subjectId: arabicSubject, termId: term2._id },
      { _id: new mongoose.Types.ObjectId().toString(), subjectId: arabicSubject, termId: term3._id },
    ];
    const csOfferings = [
      { _id: new mongoose.Types.ObjectId().toString(), subjectId: csSubject, termId: term1._id }, // Term 1 ONLY
    ];
    const artOfferings = [
      { _id: new mongoose.Types.ObjectId().toString(), subjectId: artSubject, termId: term1._id },
      { _id: new mongoose.Types.ObjectId().toString(), subjectId: artSubject, termId: term2._id },
      { _id: new mongoose.Types.ObjectId().toString(), subjectId: artSubject, termId: term3._id },
    ];

    const allOfferings = [
      ...mathOfferings,
      ...arabicOfferings,
      ...csOfferings,
      ...artOfferings,
    ];

    const ahmedId = new mongoose.Types.ObjectId().toString();
    const saraId = new mongoose.Types.ObjectId().toString();
    const mohamedId = new mongoose.Types.ObjectId().toString();

    // Mock student grades per offering
    const termGradesMap: Record<string, Record<string, number>> = {
      [ahmedId]: {
        [mathOfferings[0]._id]: 80,
        [mathOfferings[1]._id]: 76,
        [mathOfferings[2]._id]: 78,
        [arabicOfferings[0]._id]: 66,
        [arabicOfferings[1]._id]: 64,
        [arabicOfferings[2]._id]: 65,
        [csOfferings[0]._id]: 85,
        [artOfferings[0]._id]: 90,
        [artOfferings[1]._id]: 90,
        [artOfferings[2]._id]: 90,
      },
      [saraId]: {
        [mathOfferings[0]._id]: 62,
        [mathOfferings[1]._id]: 58,
        [mathOfferings[2]._id]: 60,
        [arabicOfferings[0]._id]: 57,
        [arabicOfferings[1]._id]: 53,
        [arabicOfferings[2]._id]: 55,
        [csOfferings[0]._id]: 72,
        [artOfferings[0]._id]: 40,
        [artOfferings[1]._id]: 40,
        [artOfferings[2]._id]: 40,
      },
      [mohamedId]: {
        [mathOfferings[0]._id]: 48,
        [mathOfferings[1]._id]: 42,
        [mathOfferings[2]._id]: 45,
        [arabicOfferings[0]._id]: 42,
        [arabicOfferings[1]._id]: 38,
        [arabicOfferings[2]._id]: 40,
        [csOfferings[0]._id]: 70,
        [artOfferings[0]._id]: 20,
        [artOfferings[1]._id]: 20,
        [artOfferings[2]._id]: 20,
      },
    };

    const mockTermModel: any = {
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([term1, term2, term3]),
        }),
      }),
    };

    const mockSchoolModel: any = {
      findById: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ settings: { defaultPassingGrade: 50 } }),
        }),
      }),
    };

    const mockSubjectOfferingModel: any = {
      find: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(allOfferings),
        }),
      }),
    };

    const mockTenantContext: any = {
      getSchoolId: jest.fn().mockReturnValue('school-1'),
    };

    const service = new GradesCriteriaService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockSubjectOfferingModel,
      mockTermModel,
      mockSchoolModel,
      mockTenantContext,
    );

    jest.spyOn(service, 'calculateStudentTermGrade').mockImplementation(async (studentId, offeringId) => {
      const grade = termGradesMap[studentId]?.[offeringId] ?? 0;
      return { finalGrade: grade, passingGrade: 50, hasGrade: true };
    });

    const gradeLevelId = new mongoose.Types.ObjectId().toString();
    const academicYearId = new mongoose.Types.ObjectId().toString();

    // 1. Ahmed
    const ahmedResults = await service.calculateStudentYearlySubjectResults(ahmedId, gradeLevelId, academicYearId);
    const ahmedPassed = ahmedResults.filter((s) => s.isRequiredForPromotion !== false).every((s) => s.passed);
    expect(ahmedPassed).toBe(true);

    const ahmedCs = ahmedResults.find((s) => s.subjectId === csId);
    expect(ahmedCs?.finalGrade).toBe(85); // 85 averaged over 1 term, NOT 85 / 3

    // 2. Sara
    const saraResults = await service.calculateStudentYearlySubjectResults(saraId, gradeLevelId, academicYearId);
    const saraPassed = saraResults.filter((s) => s.isRequiredForPromotion !== false).every((s) => s.passed);
    expect(saraPassed).toBe(true); // Passed Math, Arabic, CS; Art (elective) failed but ignored for overallPassed

    const saraArt = saraResults.find((s) => s.subjectId === artId);
    expect(saraArt?.passed).toBe(false);
    expect(saraArt?.isRequiredForPromotion).toBe(false);

    // 3. Mohamed
    const mohamedResults = await service.calculateStudentYearlySubjectResults(mohamedId, gradeLevelId, academicYearId);
    const mohamedPassed = mohamedResults.filter((s) => s.isRequiredForPromotion !== false).every((s) => s.passed);
    expect(mohamedPassed).toBe(false); // Failed Math (45) & Arabic (40)

    const mohamedCs = mohamedResults.find((s) => s.subjectId === csId);
    expect(mohamedCs?.passed).toBe(true);
  });
});
