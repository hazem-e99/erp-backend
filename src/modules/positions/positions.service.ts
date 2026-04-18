import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Position, PositionDocument } from './schemas/position.schema';
import { CreatePositionDto, UpdatePositionDto } from './dto/position.dto';

@Injectable()
export class PositionsService {
  constructor(
    @InjectModel(Position.name) private positionModel: Model<PositionDocument>,
  ) {}

  async create(dto: CreatePositionDto): Promise<Position> {
    const existing = await this.positionModel.findOne({ name: dto.name });
    if (existing) {
      throw new ConflictException('Position with this name already exists');
    }
    const position = new this.positionModel(dto);
    return position.save();
  }

  async findAll(): Promise<Position[]> {
    return this.positionModel.find().sort({ name: 1 }).exec();
  }

  async findOne(id: string): Promise<Position> {
    const position = await this.positionModel.findById(id);
    if (!position) {
      throw new NotFoundException('Position not found');
    }
    return position;
  }

  async update(id: string, dto: UpdatePositionDto): Promise<Position> {
    const position = await this.positionModel.findByIdAndUpdate(id, dto, { new: true });
    if (!position) {
      throw new NotFoundException('Position not found');
    }
    return position;
  }

  async remove(id: string): Promise<void> {
    const result = await this.positionModel.findByIdAndDelete(id);
    if (!result) {
      throw new NotFoundException('Position not found');
    }
  }
}
