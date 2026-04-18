import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ContractType, ContractTypeDocument } from './schemas/contract-type.schema';
import { CreateContractTypeDto, UpdateContractTypeDto } from './dto/contract-type.dto';

@Injectable()
export class ContractTypesService {
  constructor(
    @InjectModel(ContractType.name) private contractTypeModel: Model<ContractTypeDocument>,
  ) {}

  async create(dto: CreateContractTypeDto): Promise<ContractType> {
    const existing = await this.contractTypeModel.findOne({ name: dto.name });
    if (existing) {
      throw new ConflictException('Contract type with this name already exists');
    }
    const contractType = new this.contractTypeModel(dto);
    return contractType.save();
  }

  async findAll(): Promise<ContractType[]> {
    return this.contractTypeModel.find().sort({ name: 1 }).exec();
  }

  async findOne(id: string): Promise<ContractType> {
    const contractType = await this.contractTypeModel.findById(id);
    if (!contractType) {
      throw new NotFoundException('Contract type not found');
    }
    return contractType;
  }

  async update(id: string, dto: UpdateContractTypeDto): Promise<ContractType> {
    const contractType = await this.contractTypeModel.findByIdAndUpdate(id, dto, { new: true });
    if (!contractType) {
      throw new NotFoundException('Contract type not found');
    }
    return contractType;
  }

  async remove(id: string): Promise<void> {
    const result = await this.contractTypeModel.findByIdAndDelete(id);
    if (!result) {
      throw new NotFoundException('Contract type not found');
    }
  }
}
