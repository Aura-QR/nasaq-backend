import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      service: 'gmail',
      auth: {
        user: 'liom0771@gmail.com',
        pass: 'ndawyxlayhgqtual',
      },
    });
  }

  async sendOtp(to: string, otp: string): Promise<void> {
    await this.transporter.sendMail({
      from: 'liom0771@gmail.com',
      to,
      subject: 'كود تفعيل كلمة المرور - Aura School',
      html: `
        <div style="font-family: Arial, sans-serif; direction: rtl; text-align: right;">
          <h2>مرحباً،</h2>
          <p>استخدم الكود التالي لتعيين كلمة المرور الخاصة بك:</p>
          <h1 style="letter-spacing: 8px; color: #4F46E5;">${otp}</h1>
          <p>هذا الكود صالح لمدة <strong>15 دقيقة</strong> فقط.</p>
          <p>إذا لم تطلب هذا الكود، تجاهل هذه الرسالة.</p>
        </div>
      `,
    });
  }
}
