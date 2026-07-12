import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { Admin } from './schemas/admin.schema';
import { CreateAdminDto } from './dto/create-admin.dto';
import { LoginAdminDto } from './dto/login-admin.dto';

@Injectable()
export class AdminService {
  constructor(
    @InjectModel(Admin.name)
    private readonly adminModel: Model<Admin>,
  ) { }

  async register(createAdminDto: CreateAdminDto) {
    const { username,
      email,
      password } = createAdminDto;

    const existingAdmin = await this.adminModel.findOne({
      $or: [{ username }, { email }],
    });

    if (existingAdmin) {
      if (existingAdmin.username === username) {
        throw new ConflictException('اسم المستخدم مستخدم بالفعل');
      }
      if (existingAdmin.email === email) {
        throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const admin = new this.adminModel({
      username,
      email,
      password: hashedPassword,
    });

    await admin.save();

    return {
      message: 'تم تسجيل المسؤول بنجاح',
      admin: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
      },
    };
  }

  async login(loginAdminDto: LoginAdminDto) {
    const { identifier, password } = loginAdminDto;

    const admin = await this.adminModel.findOne({
      $or: [{ username: identifier }, { email: identifier }],
    });

    if (!admin) {
      throw new UnauthorizedException('بيانات الدخول غير صحيحة');
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('بيانات الدخول غير صحيحة');
    }

    return {
      message: 'تم تسجيل الدخول بنجاح',
      admin: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
      },
    };
  }

  async findAll() {
    const admins = await this.adminModel.find().select('-password').exec();

    return {
      count: admins.length,
      admins,
    };
  }

  async findOne(id: string) {
    const admin = await this.adminModel.findById(id).select('-password').exec();

    if (!admin) {
      throw new NotFoundException(`المسؤول بمعرف ${id} غير موجود`);
    }

    return admin;
  }

  async update(id: string, updateData: Partial<CreateAdminDto>) {
    if (updateData.email || updateData.username) {
      const existingAdmin = await this.adminModel.findOne({
        $or: [{ email: updateData.email }, { username: updateData.username }],
        _id: { $ne: id },
      });

      if (existingAdmin) {
        if (existingAdmin.email === updateData.email) {
          throw new ConflictException('البريد الإلكتروني مستخدم بالفعل');
        }
        if (existingAdmin.username === updateData.username) {
          throw new ConflictException('اسم المستخدم مستخدم بالفعل');
        }
      }
    }

    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, 10);
    }

    const admin = await this.adminModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .select('-password')
      .exec();

    if (!admin) {
      throw new NotFoundException(`المسؤول بمعرف ${id} غير موجود`);
    }

    return {
      message: 'تم تحديث بيانات المسؤول بنجاح',
      admin,
    };
  }

  async remove(id: string) {
    const result = await this.adminModel.findByIdAndDelete(id).exec();

    if (!result) {
      throw new NotFoundException(`Admin with ID ${id} not found`);
    }

    return {
      message: 'تم حذف المسؤول بنجاح',
    };
  }
}