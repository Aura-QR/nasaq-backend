import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { calculateHaversineDistance, TeacherAttendanceService } from './teacher-attendance.service';

describe('TeacherAttendanceService Unit & Integration Tests', () => {
  let service: TeacherAttendanceService;
  let teacherAttendanceModel: any;
  let teacherModel: any;
  let schoolModel: any;
  let leaveRequestModel: any;

  const mockSchoolId = '60d5ecb8b5c9c22b8c8b4561';
  const mockTeacherId = '60d5ecb8b5c9c22b8c8b4562';
  const mockAdminId = '60d5ecb8b5c9c22b8c8b4563';

  const defaultSchoolSettings = {
    teacherCheckInEnabled: true,
    location: { lat: 24.7136, lng: 46.6753 },
    checkInRadiusMeters: 150,
    schoolNetworkIps: ['192.168.1.100', '10.0.0.1'],
  };

  // extractClientIp reads req.ip ONLY. Express derives that from
  // X-Forwarded-For using the `trust proxy` hop count set in main.ts, so a
  // header the caller prepended never reaches us. These fixtures deliberately
  // carry a hostile x-forwarded-for to prove it is ignored — an earlier version
  // read the header directly, which let any teacher check in from home by
  // claiming the school's IP.
  const onSchoolNetwork = {
    ip: '192.168.1.100',
    headers: { 'x-forwarded-for': '203.0.113.5' },
  };
  const offSchoolNetwork = {
    ip: '203.0.113.5',
    headers: { 'x-forwarded-for': '192.168.1.100' },
  };

  beforeEach(() => {
    teacherAttendanceModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      findByIdAndDelete: jest.fn(),
      countDocuments: jest.fn(),
    };

    teacherModel = {
      findById: jest.fn(),
      find: jest.fn(),
    };

    schoolModel = {
      // createManual and update() read workStartTime/timezone through this now,
      // so the default has to resolve rather than be left unset — the tests
      // that care about specific settings still override it per case.
      findById: jest.fn().mockReturnValue({
        setOptions: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ settings: defaultSchoolSettings }),
        }),
      }),
    };

    // No approved leave by default, so early-leave stays measured. The cases
    // that care about an approved استئذان override this.
    leaveRequestModel = {
      findOne: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(null),
        }),
      }),
    };

    service = new TeacherAttendanceService(
      teacherAttendanceModel as any,
      teacherModel as any,
      schoolModel as any,
      leaveRequestModel as any,
    );
  });

  describe('Haversine Distance Calculator', () => {
    it('should return 0 meters for identical coordinates', () => {
      const dist = calculateHaversineDistance(
        { lat: 24.7136, lng: 46.6753 },
        { lat: 24.7136, lng: 46.6753 },
      );
      expect(dist).toBe(0);
    });

    it('should correctly calculate non-zero distance', () => {
      // Approx 111 meters offset (0.001 deg lat is ~111m)
      const dist = calculateHaversineDistance(
        { lat: 24.7136, lng: 46.6753 },
        { lat: 24.7146, lng: 46.6753 },
      );
      expect(dist).toBeGreaterThan(100);
      expect(dist).toBeLessThan(120);
    });
  });

  describe('checkIn (Teacher Self Check-In)', () => {
    const teacherUser = {
      userId: mockTeacherId,
      schoolId: mockSchoolId,
      role: 'TEACHER',
    };

    it('should throw 400 if teacherCheckInEnabled is false', async () => {
      schoolModel.findById.mockReturnValue({
        setOptions: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            settings: { ...defaultSchoolSettings, teacherCheckInEnabled: false },
          }),
        }),
      });

      await expect(
        service.checkIn(teacherUser, { lat: 24.7136, lng: 46.6753 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw 400 if school location is not configured', async () => {
      schoolModel.findById.mockReturnValue({
        setOptions: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({
            settings: { ...defaultSchoolSettings, location: null },
          }),
        }),
      });

      await expect(
        service.checkIn(teacherUser, { lat: 24.7136, lng: 46.6753 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw 409 Conflict if already checked in today', async () => {
      schoolModel.findById.mockReturnValue({
        setOptions: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ settings: defaultSchoolSettings }),
        }),
      });

      const existingRecord = {
        _id: 'rec1',
        checkInAt: new Date('2026-08-11T07:50:00Z'),
        distanceMeters: 30,
        verification: { gps: true, network: true },
      };

      teacherAttendanceModel.findOne.mockResolvedValue(existingRecord);

      try {
        await service.checkIn(teacherUser, { lat: 24.7136, lng: 46.6753 });
        fail('Should have thrown HttpException 409');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpException);
        expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
        const res = err.getResponse();
        expect(res.data.checkInAt).toEqual(existingRecord.checkInAt);
      }
    });

    it('should succeed with { gps: true, network: true } when inside radius and on school network', async () => {
      schoolModel.findById.mockReturnValue({
        setOptions: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ settings: defaultSchoolSettings }),
        }),
      });

      teacherAttendanceModel.findOne.mockResolvedValue(null);

      teacherModel.findById.mockReturnValue({
        setOptions: jest.fn().mockResolvedValue({ name: 'أحمد محمود' }),
      });

      teacherAttendanceModel.create.mockResolvedValue({
        checkInAt: new Date(),
        distanceMeters: 0,
        verification: { gps: true, network: true },
      });

      const mockReq = onSchoolNetwork;

      const result = await service.checkIn(
        teacherUser,
        { lat: 24.7136, lng: 46.6753 },
        mockReq,
      );

      expect(result.status).toBe(true);
      expect(result.data.verification).toEqual({ gps: true, network: true });
      expect(teacherAttendanceModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'location',
          recordedBy: null,
          name: 'أحمد محمود',
          verification: { gps: true, network: true },
        }),
      );
    });

    it('should succeed with { gps: true, network: false } when inside radius but off network', async () => {
      schoolModel.findById.mockReturnValue({
        setOptions: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ settings: defaultSchoolSettings }),
        }),
      });

      teacherAttendanceModel.findOne.mockResolvedValue(null);
      teacherModel.findById.mockReturnValue({
        setOptions: jest.fn().mockResolvedValue({ name: 'أحمد محمود' }),
      });

      teacherAttendanceModel.create.mockResolvedValue({
        checkInAt: new Date(),
        distanceMeters: 10,
        verification: { gps: true, network: false },
      });

      const mockReq = offSchoolNetwork;

      const result = await service.checkIn(
        teacherUser,
        { lat: 24.7136, lng: 46.6753 },
        mockReq,
      );

      expect(result.status).toBe(true);
      expect(result.data.verification).toEqual({ gps: true, network: false });
    });

    it('should succeed with { gps: false, network: true } when outside radius but on network', async () => {
      schoolModel.findById.mockReturnValue({
        setOptions: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ settings: defaultSchoolSettings }),
        }),
      });

      teacherAttendanceModel.findOne.mockResolvedValue(null);
      teacherModel.findById.mockReturnValue({
        setOptions: jest.fn().mockResolvedValue({ name: 'أحمد محمود' }),
      });

      teacherAttendanceModel.create.mockResolvedValue({
        checkInAt: new Date(),
        distanceMeters: 500,
        verification: { gps: false, network: true },
      });

      // Coordinates ~500m away (lat offset 0.005)
      const mockReq = onSchoolNetwork;

      const result = await service.checkIn(
        teacherUser,
        { lat: 24.7186, lng: 46.6753 },
        mockReq,
      );

      expect(result.status).toBe(true);
      expect(result.data.verification).toEqual({ gps: false, network: true });
    });

    it('should throw 403 Forbidden when BOTH radius and network checks fail', async () => {
      schoolModel.findById.mockReturnValue({
        setOptions: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ settings: defaultSchoolSettings }),
        }),
      });

      teacherAttendanceModel.findOne.mockResolvedValue(null);

      // Coordinates ~500m away and unrecognized IP
      const mockReq = offSchoolNetwork;

      await expect(
        service.checkIn(teacherUser, { lat: 24.7186, lng: 46.6753 }, mockReq),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should ignore a spoofed X-Forwarded-For claiming the school IP', async () => {
      schoolModel.findById.mockReturnValue({
        setOptions: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue({ settings: defaultSchoolSettings }),
        }),
      });

      teacherAttendanceModel.findOne.mockResolvedValue(null);

      // A teacher at home: real peer is off-network, but the request carries
      // "X-Forwarded-For: 192.168.1.100" — the school's own IP. If that header
      // were trusted the network check would pass and this would be recorded
      // as "was on the school network".
      const spoofed = {
        ip: '203.0.113.5',
        headers: { 'x-forwarded-for': '192.168.1.100' },
      };

      await expect(
        service.checkIn(teacherUser, { lat: 24.7186, lng: 46.6753 }, spoofed),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createManual (Admin Manual Entry)', () => {
    const adminUser = {
      userId: mockAdminId,
      schoolId: mockSchoolId,
      role: 'OWNER',
    };

    // Derived, not hard-coded — a literal date silently becomes a future date
    // once the calendar passes it, and the test would start failing on its own.
    const dayOffset = (days: number) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const yesterday = dayOffset(-1);
    const tomorrow = dayOffset(1);

    it('should create a manual attendance record with recordedBy set to admin ID', async () => {
      teacherModel.findById.mockResolvedValue({ _id: mockTeacherId, name: 'فاطمة علي' });
      teacherAttendanceModel.findOne.mockResolvedValue(null);
      teacherAttendanceModel.create.mockImplementation((doc) => Promise.resolve({ _id: 'rec2', ...doc }));

      const result = await service.createManual(adminUser, {
        teacherId: mockTeacherId,
        date: yesterday,
        checkInAt: '07:45',
        notes: 'عطل في تحديد الموقع',
      });

      expect(result.method).toBe('manual');
      expect(result.recordedBy.toString()).toBe(mockAdminId);
      expect(result.verification).toEqual({ gps: false, network: false });
      expect(result.name).toBe('فاطمة علي');
    });

    it('should reject a future date', async () => {
      teacherModel.findById.mockResolvedValue({ _id: mockTeacherId, name: 'فاطمة علي' });

      await expect(
        service.createManual(adminUser, {
          teacherId: mockTeacherId,
          date: tomorrow,
          checkInAt: '07:45',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw 404 if teacher is not found', async () => {
      teacherModel.findById.mockResolvedValue(null);

      await expect(
        service.createManual(adminUser, {
          teacherId: mockTeacherId,
          date: yesterday,
          checkInAt: '07:45',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAbsent (Active Teachers with No Record)', () => {
    it('should return active teachers missing a record for today', async () => {
      const teacher1 = { _id: { toString: () => 't1' }, name: 'معلم 1', isActive: true };
      const teacher2 = { _id: { toString: () => 't2' }, name: 'معلم 2', isActive: true };
      const teacher3 = { _id: { toString: () => 't3' }, name: 'معلم 3', isActive: true };

      teacherModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([teacher1, teacher2, teacher3]),
        }),
      });

      // Teacher 2 has checked in
      teacherAttendanceModel.find.mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([{ teacherId: { toString: () => 't2' } }]),
        }),
      });

      const result = await service.findAbsent('2026-09-20');

      expect(result.totalAbsent).toBe(2);
      expect(result.absentTeachers).toEqual([teacher1, teacher3]);
    });
  });

  describe('an approved استئذان and leaving early', () => {
    const leaveAt = (record: any, hhmm: string) => {
      teacherAttendanceModel.findOne = jest.fn().mockResolvedValue(record);
      void hhmm;
    };

    /**
     * A check-in record with no check-out yet, ready to be closed. Anchored to
     * now rather than a fixed date: checkOut stamps the real clock, and a
     * fixture in the future makes the day's work come out negative.
     */
    const openRecord = () => {
      const now = new Date();
      const midnight = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      return {
        _id: 'rec-1',
        teacherId: mockTeacherId,
        date: midnight,
        checkInAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
        checkOutAt: null,
        save: jest.fn().mockResolvedValue(true),
      };
    };

    const checkOut = () =>
      service.checkOut(
        { userId: mockTeacherId, schoolId: mockSchoolId, role: 'TEACHER' },
        { lat: 24.7136, lng: 46.6753 } as any,
        onSchoolNetwork,
      );

    it('records the departure as approved when a request was approved', async () => {
      const record: any = openRecord();
      leaveAt(record, '11:00');
      leaveRequestModel.findOne = jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ leaveAt: '11:00', status: 'approved' }),
        }),
      });

      const result: any = await checkOut();

      expect(record.earlyLeaveApproved).toBe(true);
      expect(record.approvedLeaveAt).toBe('11:00');
      expect(result.data.earlyLeaveApproved).toBe(true);
    });

    it('still records the minutes — the clock is the clock', async () => {
      const record: any = openRecord();
      leaveAt(record, '11:00');
      leaveRequestModel.findOne = jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ leaveAt: '11:00', status: 'approved' }),
        }),
      });

      await checkOut();

      // Hiding the number would make a permitted departure indistinguishable
      // from a day that was never measured.
      expect(record).toHaveProperty('earlyLeaveMinutes');
    });

    it('leaves the flag off when there is no approved request', async () => {
      const record: any = openRecord();
      leaveAt(record, '');

      const result: any = await checkOut();

      expect(record.earlyLeaveApproved).toBe(false);
      expect(record.approvedLeaveAt).toBeNull();
      expect(result.data.earlyLeaveApproved).toBe(false);
    });
  });
});
