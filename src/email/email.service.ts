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

  /** Used for student first-time password SETUP flow */
  async sendOtp(to: string, otp: string): Promise<void> {
    await this.transporter.sendMail({
      from: 'liom0771@gmail.com',
      to,
      subject: 'كود تفعيل كلمة المرور - Nasaq School',
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

  /** Used for ALL users' forgot-password / reset-password flow */
  async sendPasswordResetOtp(to: string, otp: string): Promise<void> {
    await this.transporter.sendMail({
      from: 'liom0771@gmail.com',
      to,
      subject: 'إعادة تعيين كلمة المرور - نظام نسق',
      html: `
        <div style="font-family: Arial, sans-serif; direction: rtl; text-align: right; background-color: #f4f4f8; padding: 40px;">
          <div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 4px 16px rgba(0,0,0,0.08);">

            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #1a1a2e; font-size: 22px; margin: 0;">نظام نسق المدرسي</h1>
              <p style="color: #6b7280; font-size: 14px; margin-top: 4px;">إعادة تعيين كلمة المرور</p>
            </div>

            <p style="color: #374151; font-size: 16px; line-height: 1.7; margin-bottom: 12px;">مرحباً،</p>
            <p style="color: #374151; font-size: 15px; line-height: 1.7; margin-bottom: 24px;">
              تلقينا طلباً لإعادة تعيين كلمة المرور الخاصة بحسابك. استخدم رمز التحقق التالي:
            </p>

            <div style="background: #eff0ff; border: 1px solid #c7d2fe; border-radius: 10px; padding: 24px; text-align: center; margin-bottom: 24px;">
              <span style="font-size: 40px; letter-spacing: 12px; color: #4338ca; font-weight: 700; font-family: 'Courier New', monospace;">
                ${otp}
              </span>
            </div>

            <p style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">
              ⏳ هذا الرمز صالح لمدة <strong>15 دقيقة</strong> فقط من وقت الإرسال.
            </p>
            <p style="color: #6b7280; font-size: 14px; margin-bottom: 32px;">
              🔒 إذا لم تطلب إعادة تعيين كلمة المرور، يُرجى تجاهل هذه الرسالة — حسابك بأمان.
            </p>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin-bottom: 20px;" />
            <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 0;">
              نظام نسق المدرسي — Nasaq School System
            </p>

          </div>
        </div>
      `,
    });
  }
}

