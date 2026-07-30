import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any) {
    if (err || !user) {
      if (info?.name === 'TokenExpiredError') {
        throw new UnauthorizedException('انتهت صلاحية جلسة الدخول (Token Expired)، يرجى إعادة تسجيل الدخول');
      }
      if (info?.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('رمز التحقق (JWT Token) غير صالح أو صيغته خاطئة');
      }
      throw err || new UnauthorizedException('رمز التحقق مفقود أو غير صالح (Invalid or Expired Token)');
    }
    return user;
  }
}
