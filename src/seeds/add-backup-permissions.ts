// Adds backup/restore permissions to the Super Admin role (and 'admin' role if present).
// Usage: npx ts-node src/seeds/add-backup-permissions.ts

import mongoose from 'mongoose';
import { config } from 'dotenv';

config();

const BACKUP_PERMISSIONS = [
  'backup:export',
  'backup:import',
  'backup:list',
  'backup:delete',
];

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/erp';

  await mongoose.connect(uri);
  console.log('Connected to MongoDB');

  const db = mongoose.connection.db;
  if (!db) throw new Error('Database connection not established');
  const roles = db.collection('roles');

  // Super Admin already has '*', so these permissions are implicitly granted — but we add them
  // explicitly so the frontend `hasPermission('backup:export')` check works even on non-wildcard
  // admin roles.
  const targets = await roles.find({ name: { $in: ['Super Admin', 'admin'] } }).toArray();
  if (targets.length === 0) {
    console.log('No Super Admin / admin role found — nothing to do.');
    await mongoose.connection.close();
    return;
  }

  for (const role of targets) {
    const existing: string[] = role.permissions ?? [];
    if (existing.includes('*')) {
      console.log(`Role "${role.name}" already has wildcard '*' — skipping explicit add`);
      continue;
    }
    const toAdd = BACKUP_PERMISSIONS.filter((p) => !existing.includes(p));
    if (toAdd.length === 0) {
      console.log(`Role "${role.name}" already has all backup permissions`);
      continue;
    }
    await roles.updateOne({ _id: role._id }, { $addToSet: { permissions: { $each: toAdd } } });
    console.log(`Added ${toAdd.length} backup permissions to role "${role.name}"`);
  }

  await mongoose.connection.close();
  console.log('Done.');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
