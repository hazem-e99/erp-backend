import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Announcement, AnnouncementDocument } from './schemas/announcement.schema';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Employee, EmployeeDocument } from '../employees/schemas/employee.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Role, RoleDocument } from '../roles/schemas/role.schema';
import { CreateAnnouncementDto } from './dto/announcement.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    @InjectModel(Announcement.name) private announcementModel: Model<AnnouncementDocument>,
    @InjectModel(Notification.name) private notificationModel: Model<NotificationDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Employee.name) private employeeModel: Model<EmployeeDocument>,
    @InjectModel(Project.name) private projectModel: Model<ProjectDocument>,
    @InjectModel(Role.name) private roleModel: Model<RoleDocument>,
  ) {}

  /**
   * Create announcement + bulk generate notifications
   */
  async create(dto: CreateAnnouncementDto, senderId: string) {
    // 1. Resolve target user IDs
    const targetUserIds = await this.resolveTargetUsers(dto.targetType, dto.targetIds || []);

    // 2. Create announcement
    const announcement = await this.announcementModel.create({
      senderId: new Types.ObjectId(senderId),
      title: dto.title,
      message: dto.message,
      targetType: dto.targetType,
      targetIds: dto.targetIds || [],
      recipientCount: targetUserIds.length,
      readCount: 0,
    } as any);

    // 3. Bulk insert notifications (optimized for many users)
    if (targetUserIds.length > 0) {
      const notifications = targetUserIds.map(userId => ({
        userId: new Types.ObjectId(userId),
        title: dto.title,
        message: dto.message,
        type: 'announcement',
        announcementId: announcement._id,
        isRead: false,
      }));
      await this.notificationModel.insertMany(notifications);
    }

    return {
      announcement,
      recipientCount: targetUserIds.length,
    };
  }

  /**
   * Resolve which users should receive the announcement
   */
  private async resolveTargetUsers(targetType: string, targetIds: string[]): Promise<string[]> {
    let userIds: string[] = [];

    switch (targetType) {
      case 'all': {
        const users = await this.userModel.find({ isActive: true }).select('_id');
        userIds = users.map(u => u._id.toString());
        break;
      }
      case 'users': {
        userIds = targetIds;
        break;
      }
      case 'roles': {
        const users = await this.userModel.find({
          role: { $in: targetIds.map(id => new Types.ObjectId(id)) },
          isActive: true,
        }).select('_id');
        userIds = users.map(u => u._id.toString());
        break;
      }
      case 'departments': {
        const employees = await this.employeeModel.find({
          $or: [
            { department: { $in: targetIds } },
            { departments: { $in: targetIds } },
          ],
          status: 'active',
        }).select('userId');
        userIds = employees.map(e => e.userId.toString());
        break;
      }
      case 'projects': {
        const projects = await this.projectModel.find({
          _id: { $in: targetIds.map(id => new Types.ObjectId(id)) },
        }).select('teamMembers');
        const memberIds = new Set<string>();
        for (const p of projects) {
          for (const m of (p as any).teamMembers || []) {
            const uid = m.userId?.toString() || m.employeeId?.toString();
            if (uid) memberIds.add(uid);
          }
        }
        // If teamMembers reference employees, resolve to userIds
        if (memberIds.size > 0) {
          const emps = await this.employeeModel.find({
            $or: [
              { _id: { $in: Array.from(memberIds).map(id => new Types.ObjectId(id)) } },
              { userId: { $in: Array.from(memberIds).map(id => new Types.ObjectId(id)) } },
            ],
          }).select('userId');
          userIds = emps.map(e => e.userId.toString());
          // Also add direct user IDs
          for (const id of memberIds) userIds.push(id);
        }
        userIds = [...new Set(userIds)]; // deduplicate
        break;
      }
    }
    return [...new Set(userIds)];
  }

  /**
   * List all announcements (for admin/HR)
   */
  async findAll(query: any = {}) {
    const { page = 1, limit = 20 } = query;
    const total = await this.announcementModel.countDocuments();
    const data = await this.announcementModel
      .find()
      .populate({ path: 'senderId', select: 'name email' })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    // Update read counts
    for (const ann of data) {
      const readCount = await this.notificationModel.countDocuments({
        announcementId: ann._id,
        isRead: true,
      });
      if (readCount !== ann.recipientCount) {
        ann.readCount = readCount;
      }
    }

    return { data, total, page: +page, limit: +limit };
  }

  async findById(id: string) {
    const ann = await this.announcementModel.findById(id)
      .populate({ path: 'senderId', select: 'name email' });
    if (!ann) throw new NotFoundException('Announcement not found');

    const readCount = await this.notificationModel.countDocuments({ announcementId: ann._id, isRead: true });
    ann.readCount = readCount;

    return ann;
  }

  // ─── Notification methods ───

  async getMyNotifications(userId: string, query: any = {}) {
    const { page = 1, limit = 30, filter } = query;
    const f: any = { userId: new Types.ObjectId(userId) };
    if (filter === 'unread') f.isRead = false;
    if (filter === 'read') f.isRead = true;

    const total = await this.notificationModel.countDocuments(f);
    const unreadCount = await this.notificationModel.countDocuments({ userId: new Types.ObjectId(userId), isRead: false });
    const data = await this.notificationModel
      .find(f)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return { data, total, unreadCount, page: +page, limit: +limit };
  }

  async getUnreadCount(userId: string) {
    const count = await this.notificationModel.countDocuments({
      userId: new Types.ObjectId(userId),
      isRead: false,
    });
    return { count };
  }

  async markAsRead(notificationId: string, userId: string) {
    const n = await this.notificationModel.findOneAndUpdate(
      { _id: notificationId, userId: new Types.ObjectId(userId) },
      { isRead: true },
      { new: true },
    );
    if (!n) throw new NotFoundException('Notification not found');
    return n;
  }

  async markAllAsRead(userId: string) {
    await this.notificationModel.updateMany(
      { userId: new Types.ObjectId(userId), isRead: false },
      { isRead: true },
    );
    return { message: 'All notifications marked as read' };
  }

  async deleteNotification(notificationId: string, userId: string) {
    const n = await this.notificationModel.findOneAndDelete({
      _id: notificationId,
      userId: new Types.ObjectId(userId),
    });
    if (!n) throw new NotFoundException('Notification not found');
    return { message: 'Notification deleted' };
  }
}
