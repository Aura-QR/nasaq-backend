import { PartialType } from '@nestjs/mapped-types';
import { CreateGradesCriteriaDto } from './create-grades-criteria.dto';

export class UpdateGradesCriteriaDto extends PartialType(CreateGradesCriteriaDto) {}