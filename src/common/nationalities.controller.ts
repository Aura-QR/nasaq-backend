import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { NATIONALITIES } from './constants/nationalities.constant';

@Controller('nationalities')
@ApiTags('Reference Data - Nationalities')
export class NationalitiesController {
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get reference list of nationalities (codes and localized labels)' })
  getNationalities() {
    return {
      message: 'تم استرجاع قائمة الجنسيات بنجاح',
      data: NATIONALITIES,
    };
  }
}
