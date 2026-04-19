import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditLog, AuditLogDocument, AuditAction, AuditEntity, AuditStatus } from './schemas/audit-log.schema';
import { CreateAuditLogDto, QueryAuditLogDto } from './dto/audit-log.dto';

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name) private auditLogModel: Model<AuditLogDocument>,
  ) {}

  /**
   * Create an audit log entry
   */
  async log(dto: CreateAuditLogDto): Promise<AuditLog> {
    const auditLog = new this.auditLogModel(dto);
    return auditLog.save();
  }

  /**
   * Simplified logging method for common use cases
   */
  async logAction(params: {
    userId: string;
    userEmail: string;
    userName: string;
    action: AuditAction;
    entity: AuditEntity;
    entityId?: string;
    description?: string;
    oldData?: Record<string, any>;
    newData?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }): Promise<AuditLog> {
    return this.log({
      ...params,
      status: AuditStatus.SUCCESS,
    });
  }

  /**
   * Log failed action
   */
  async logFailure(params: {
    userId: string;
    userEmail: string;
    userName: string;
    action: AuditAction;
    entity: AuditEntity;
    entityId?: string;
    errorMessage: string;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuditLog> {
    return this.log({
      ...params,
      status: AuditStatus.FAILED,
    });
  }

  /**
   * Get audit logs with filters and pagination
   */
  async findAll(query: QueryAuditLogDto) {
    const {
      userId,
      action,
      entity,
      entityId,
      status,
      startDate,
      endDate,
      search,
      page = 1,
      limit = 50,
    } = query;

    const filter: any = {};

    if (userId) filter.userId = userId;
    if (action) filter.action = action;
    if (entity) filter.entity = entity;
    if (entityId) filter.entityId = entityId;
    if (status) filter.status = status;

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    // Search in description, userEmail, userName
    if (search) {
      filter.$or = [
        { description: { $regex: search, $options: 'i' } },
        { userEmail: { $regex: search, $options: 'i' } },
        { userName: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      this.auditLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'email name')
        .lean()
        .exec(),
      this.auditLogModel.countDocuments(filter),
    ]);

    return {
      data: logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get audit log by ID
   */
  async findById(id: string): Promise<AuditLog | null> {
    return this.auditLogModel
      .findById(id)
      .populate('userId', 'email name')
      .exec();
  }

  /**
   * Get recent activity for a specific user
   */
  async getUserActivity(userId: string, limit: number = 20): Promise<AuditLog[]> {
    return this.auditLogModel
      .find({ userId: userId as any })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Get statistics for dashboard
   */
  async getStats(startDate?: Date, endDate?: Date) {
    const filter: any = {};
    
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = startDate;
      if (endDate) filter.createdAt.$lte = endDate;
    }

    const [
      totalLogs,
      actionStats,
      entityStats,
      userStats,
      statusStats,
    ] = await Promise.all([
      this.auditLogModel.countDocuments(filter),
      this.auditLogModel.aggregate([
        { $match: filter },
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.auditLogModel.aggregate([
        { $match: filter },
        { $group: { _id: '$entity', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      this.auditLogModel.aggregate([
        { $match: filter },
        { $group: { _id: '$userId', count: { $sum: 1 }, userEmail: { $first: '$userEmail' } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),
      this.auditLogModel.aggregate([
        { $match: filter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    return {
      totalLogs,
      byAction: actionStats,
      byEntity: entityStats,
      topUsers: userStats,
      byStatus: statusStats,
    };
  }

  /**
   * Clean old audit logs (for maintenance)
   */
  async cleanOldLogs(daysToKeep: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.auditLogModel.deleteMany({
      createdAt: { $lt: cutoffDate },
    });

    return result.deletedCount;
  }
}
