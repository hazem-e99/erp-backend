import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ContractTypesController } from './contract-types.controller';
import { ContractTypesService } from './contract-types.service';
import { ContractType, ContractTypeSchema } from './schemas/contract-type.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ContractType.name, schema: ContractTypeSchema }]),
  ],
  controllers: [ContractTypesController],
  providers: [ContractTypesService],
  exports: [ContractTypesService],
})
export class ContractTypesModule {}
