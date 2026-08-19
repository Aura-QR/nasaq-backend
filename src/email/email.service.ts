import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Outgoing email.
 *
 * The SMTP host, the account and its password used to be literals in this
 * file — a real Gmail app password, committed to the repository, usable by
 * anyone with read access to send mail as that address. They come from the
 * environment now.
 *
 * The provider is chosen by MAIL_PROVIDER so moving off Gmail is an
 * environment change rather than a code change. Gmail is a stopgap: a normal
 * account caps at roughly 500 messages a day, and mail from a personal
 * address claiming to be a school lands in spam because the school's domain
 * publishes no SPF or DKIM record for it.
 *
 *   MAIL_PROVIDER=smtp     (default)
 *     SMTP_HOST  SMTP_PORT  SMTP_USER  SMTP_PASS  MAIL_FROM
 *
 *   MAIL_PROVIDER=resend
 *     RESEND_API_KEY  MAIL_FROM
 *
 * With neither configured the service does not throw — a school losing
 * password resets is bad, a school unable to boot is worse — but it logs the
 * failure loudly at startup and again on every send, because mail that
 * silently goes nowhere is the failure nobody notices.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);

  private transporter?: nodemailer.Transporter;
  private provider = (process.env.MAIL_PROVIDER || 'smtp').toLowerCase();
  private from = process.env.MAIL_FROM || process.env.SMTP_USER || '';
  private configured = false;

  onModuleInit() {
    if (this.provider === 'resend') {
      this.configured = Boolean(process.env.RESEND_API_KEY && this.from);
      if (!this.configured) {
        this.logger.error(
          '❌ MAIL_PROVIDER=resend but RESEND_API_KEY or MAIL_FROM is missing. Email is disabled.',
        );
      }
      return;
    }

    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass || !this.from) {
      this.logger.error(
        '❌ SMTP is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_FROM). ' +
          'Password reset and student password setup emails will NOT be sent.',
      );
      return;
    }

    const port = Number(process.env.SMTP_PORT || 587);

    this.transporter = nodemailer.createTransport({
      host,
      port,
      // 465 is implicit TLS; 587 upgrades with STARTTLS. Deriving it from the
      // port avoids a silent handshake failure when only the port is changed.
      secure: port === 465,
      auth: { user, pass },
    });

    this.configured = true;
    this.logger.log(`✉️  SMTP ready — ${host}:${port} as ${this.from}`);
  }

  /** Student first-time password setup. */
  async sendOtp(to: string, otp: string): Promise<void> {
    await this.send({
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

  /** Forgot-password / reset, for every role. */
  async sendPasswordResetOtp(to: string, otp: string): Promise<void> {
    await this.send({
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

  private async send(message: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    if (!this.configured) {
      this.logger.error(
        `❌ Email not sent to ${message.to} — the mail provider is not configured.`,
      );
      return;
    }

    try {
      if (this.provider === 'resend') {
        await this.sendViaResend(message);
      } else {
        await this.transporter!.sendMail({ from: this.from, ...message });
      }
    } catch (error) {
      // A failed send must not take the request down with it: the OTP is
      // already stored, and forgot-password answers the same either way by
      // design. Losing the log is what would make this undiagnosable.
      this.logger.error(
        `❌ Failed to send to ${message.to}: ${(error as Error).message}`,
      );
    }
  }

  private async sendViaResend(message: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: this.from, ...message }),
    });

    if (!response.ok) {
      throw new Error(`Resend ${response.status}: ${await response.text()}`);
    }
  }
}
