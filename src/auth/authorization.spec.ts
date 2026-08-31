import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import * as request from 'supertest';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { Role } from './enums/role.enum';
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';

/**
 * Stands in for JwtAuthGuard: puts whatever role the test asks for on the
 * request, so the real RolesGuard is the only thing being measured.
 */
@Injectable()
class FakeAuthGuard implements CanActivate {
  static role: string | null = 'OWNER';
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest();
    req.user = FakeAuthGuard.role ? { role: FakeAuthGuard.role, userId: 'u1' } : undefined;
    return true;
  }
}

const STAFF = [Role.OWNER, Role.SUPERVISOR, Role.MANAGER, Role.SUPER_ADMIN] as const;
const OWNERS = [Role.OWNER, Role.SUPERVISOR, Role.SUPER_ADMIN] as const;

@Controller('probe')
class ProbeController {
  // Mirrors the shape applied across the structural controllers: reads open to
  // any authenticated user, writes restricted to staff.
  @Get()
  list() {
    return { ok: 'read' };
  }

  @Roles(...STAFF)
  @Post()
  create() {
    return { ok: 'created' };
  }

  @Roles(...STAFF)
  @Patch(':id')
  update() {
    return { ok: 'updated' };
  }

  @Roles(...STAFF)
  @Delete(':id')
  remove() {
    return { ok: 'removed' };
  }

  @Roles(...OWNERS)
  @Post('owner-only')
  ownerOnly() {
    return { ok: 'owner' };
  }
}

describe('RolesGuard as a global guard', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        Reflector,
        { provide: APP_GUARD, useClass: FakeAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const as = (role: string | null) => {
    FakeAuthGuard.role = role;
    return request(app.getHttpServer());
  };

  describe('reads stay open', () => {
    it.each(['OWNER', 'MANAGER', 'TEACHER', 'STUDENT'])(
      'a %s can still read',
      async (role) => {
        await as(role).get('/probe').expect(200);
      },
    );
  });

  describe('writes are staff only', () => {
    it.each(['OWNER', 'SUPERVISOR', 'MANAGER', 'SUPER_ADMIN'])(
      'a %s can write',
      async (role) => {
        await as(role).post('/probe').expect(201);
        await as(role).patch('/probe/abc').expect(200);
        await as(role).delete('/probe/abc').expect(200);
      },
    );

    it.each(['TEACHER', 'STUDENT'])('a %s is refused', async (role) => {
      // Before this, a student's token could delete an academic year.
      await as(role).post('/probe').expect(403);
      await as(role).patch('/probe/abc').expect(403);
      await as(role).delete('/probe/abc').expect(403);
    });
  });

  describe('owner-only routes exclude the manager', () => {
    it.each(['OWNER', 'SUPERVISOR', 'SUPER_ADMIN'])('a %s may', async (role) => {
      await as(role).post('/probe/owner-only').expect(201);
    });

    it('a MANAGER may not — minting managers is not an operational power', async () => {
      await as('MANAGER').post('/probe/owner-only').expect(403);
    });
  });

  it('refuses when there is no user at all', async () => {
    await as(null).post('/probe').expect(403);
  });

  it('leaves an unknown role out', async () => {
    await as('PARENT').post('/probe').expect(403);
  });
});
