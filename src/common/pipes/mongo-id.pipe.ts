import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
@Injectable()
export class MongoIdPipe implements PipeTransform<string, string> {
  transform(value: string) {
    if (!/^[a-fA-F0-9]{24}$/.test(value))
      throw new BadRequestException('صيغة المعرف غير صحيحة');
    return value;
  }
}
