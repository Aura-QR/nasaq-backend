# Web: account deletion page (`/account-deletion`)

**For:** Arwaa (`nasaq-frontend`).
**Why:** Google Play asks for a **"Delete account URL"** in the Data safety form. It must be a public page, with no sign-in, that explains how a user asks for their account and data to be deleted. Without it the store listing cannot be completed.
**Backend:** none. The page is static, and requests go by email.
**Size:** one page and one route, styled like the existing privacy page.

## Where

- Route `/account-deletion`, **public**, next to `/privacy` in `src/app/AppRouter.jsx`, with no auth wrapper.
- **Do not remove either route.** Both URLs are given to Google Play and the App Store. `/privacy` was lost once in a merge (`a5223c6`) and had to be restored.
- New file `src/pages/Privacy/AccountDeletion.jsx`. Reuse the look of `src/pages/Privacy/AppPrivacy.jsx`: the same header with the logo and «العودة إلى الرئيسية», and the same cards and fonts.
- At the end of `AppPrivacy.jsx`, in the «الاحتفاظ والحذف» section, add one link: «طلب حذف الحساب» → `/account-deletion`.

## Fixed values (use exactly)

| | |
|---|---|
| App name | **نسق** (Nasaq) |
| Developer name | **Huda Ayed A Alosaimi**, exactly as on Google Play; Google checks that it matches |
| Support email | **qraura0@gmail.com** |
| Package | `com.nasaq.app` |

## Content

Arabic first, with an English section under it. Google's reviewers read English. Formal Arabic (فصحى) only.

### Arabic

**Title:** طلب حذف الحساب — تطبيق «نسق»

**Intro:**
يوضح هذا الطلب كيفية حذف حسابك وبياناتك في تطبيق «نسق» لإدارة المدارس، المقدَّم من Huda Ayed A Alosaimi.

**Steps (numbered):**
1. أرسل رسالة إلى البريد الإلكتروني **qraura0@gmail.com** بعنوان «طلب حذف حساب».
2. اذكر في الرسالة: الاسم الكامل، واسم المدرسة، ونوع الحساب (طالب/ولي أمر، معلم، موظف، مالك مدرسة)، والبريد الإلكتروني أو رقم الجوال المسجّل في الحساب.
3. نتحقق من ملكية الحساب بالتواصل معك أو مع إدارة مدرستك، ثم ننفّذ الطلب **خلال 30 يومًا** ونبلغك بذلك.

يمكنك أيضًا طلب الحذف عن طريق إدارة مدرستك مباشرة.

**البيانات التي تُحذف:**
- بيانات الحساب: الاسم، والبريد الإلكتروني، ورقم الجوال، واسم المستخدم، وكلمة المرور.
- رموز الإشعارات الخاصة بأجهزتك.
- مواقع تسجيل الحضور (للمعلمين والموظفين).
- الملفات التي رفعتها، مثل مرفقات الأعذار والصور.

**البيانات التي قد يُحتفظ بها:**
السجلات المدرسية الرسمية (الدرجات، والحضور والغياب، والسجل المالي) مملوكة للمدرسة، وقد تحتفظ بها المدرسة وفق أنظمتها والتزاماتها النظامية، وتبقى غير مرتبطة بحساب يمكن الدخول إليه. وتُحذف النسخ الاحتياطية تلقائيًا خلال 90 يومًا.

**حذف حساب مدرسة كاملة:**
يطلبه مالك المدرسة بالطريقة نفسها، فتُحذف بيانات المدرسة وحسابات مستخدميها كافة.

**Button:** «إرسال طلب الحذف», a `mailto:` link:
```
mailto:qraura0@gmail.com?subject=طلب حذف حساب - نسق&body=الاسم:%0Aالمدرسة:%0Aنوع الحساب:%0Aالبريد أو الجوال المسجّل:
```
URL-encode the Arabic with `encodeURIComponent`. Show the address as plain text too, for people whose mail app does not open.

### English (same content, shorter)

**Title:** Delete your Nasaq account

- **App:** Nasaq (نسق), **developer:** Huda Ayed A Alosaimi.
- **How to request:** email **qraura0@gmail.com** with the subject "Account deletion request". Include your full name, school, account type (student/parent, teacher, staff, school owner) and the email or phone number on the account. You can also ask your school's administration.
- **Timing:** we verify the request and delete the account within 30 days.
- **Deleted:** account details (name, email, phone, username, password), device notification tokens, attendance check-in locations, and files you uploaded.
- **May be kept:** official school records (grades, attendance, fees) belong to the school and may be retained under its legal obligations, no longer linked to a usable account. Backups are erased within 90 days.

## Test

- Open `https://nasaqedu.org/account-deletion` in an Incognito window, not signed in. The page shows; it does not redirect to the home page or the login.
- Phone width: readable, with no sideways scrolling.
- The button opens the mail app with the subject and body filled in.
- From `/privacy`, the new link opens this page.

When it is live, the owner puts `https://nasaqedu.org/account-deletion` in Play Console → App content → Data safety → «Delete account URL».
