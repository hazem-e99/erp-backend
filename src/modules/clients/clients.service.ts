import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client, ClientDocument } from './schemas/client.schema';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

@Injectable()
export class ClientsService {
  constructor(@InjectModel(Client.name) private clientModel: Model<ClientDocument>) {}

  async findAll(query: any = {}) {
    const { page = 1, limit = 20, search, status } = query;
    const filter: any = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
      ];
    }
    if (status) filter.status = status;

    const total = await this.clientModel.countDocuments(filter);
    const clients = await this.clientModel
      .find(filter)
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });
    return { data: clients, total, page: +page, limit: +limit };
  }

  async findById(id: string) {
    const client = await this.clientModel.findById(id);
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  async create(dto: CreateClientDto) {
    return this.clientModel.create(dto);
  }

  async update(id: string, dto: UpdateClientDto) {
    const client = await this.clientModel.findByIdAndUpdate(id, dto, { new: true });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  async delete(id: string) {
    const client = await this.clientModel.findByIdAndDelete(id);
    if (!client) throw new NotFoundException('Client not found');
    return { message: 'Client deleted successfully' };
  }

  async getStats() {
    const total = await this.clientModel.countDocuments();
    const leads = await this.clientModel.countDocuments({ status: 'lead' });
    const active = await this.clientModel.countDocuments({ status: 'active' });
    const inactive = await this.clientModel.countDocuments({ status: 'inactive' });
    return { total, leads, active, inactive };
  }
}
