import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { School, SchoolSchema } from './schools/schemas/school.schema';
import { PlatformAdmin, PlatformAdminSchema } from './platform-admins/schemas/platform-admin.schema';
import { Admin, AdminSchema } from 'src/admin/schemas/admin.schema';
import { Permission, PermissionSchema } from 'src/permissions/schemas/permission.schema';
import { SchoolsService } from './schools/schools.service';
import { SchoolsController } from './schools/schools.controller';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthController } from './platform-auth.controller';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import jwtConfig from 'src/auth/config/jwt.config';
import { TenancyModule } from 'src/tenancy/tenancy.module';

import { forwardRef } from '@nestjs/common';
import { FinancialModule } from 'src/financial/financial.module';

@Module({
  imports: [
    ConfigModule.forFeature(jwtConfig),
    JwtModule.registerAsync(jwtConfig.asProvider()),
    TenancyModule,
    forwardRef(() => FinancialModule),
    MongooseModule.forFeature([
      { name: School.name, schema: SchoolSchema },
      { name: PlatformAdmin.name, schema: PlatformAdminSchema },
      { name: Admin.name, schema: AdminSchema },
      { name: Permission.name, schema: PermissionSchema },
    ]),
  ],
  controllers: [SchoolsController, PlatformAuthController],
  providers: [SchoolsService, PlatformAuthService],
  exports: [SchoolsService],
})
export class PlatformModule {}
