// Run this script to add new permissions to admin role
// Usage: npx ts-node src/seeds/add-new-permissions.ts

import mongoose from 'mongoose';
import { config } from 'dotenv';

config();

interface Role {
  name: string;
  permissions: string[];
}

const NEW_PERMISSIONS = [
  // Audit
  'audit:read',
  // Finance delete-all
  'finance:delete-all',
  // Departments
  'departments:read',
  'departments:create',
  'departments:update',
  'departments:delete',
  // Positions
  'positions:read',
  'positions:create',
  'positions:update',
  'positions:delete',
  // Contract Types
  'contract-types:read',
  'contract-types:create',
  'contract-types:update',
  'contract-types:delete',
  // Reminders
  'reminders:read',
  'reminders:create',
  'reminders:update',
  'reminders:delete',
];

async function addNewPermissions() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/erp';
  
  try {
    // Connect to MongoDB
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    // Get roles collection
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

    const rolesCollection = db.collection('roles');

    // Add all new permissions to admin role
    const result = await rolesCollection.updateOne(
      { name: 'admin' },
      { $addToSet: { permissions: { $each: NEW_PERMISSIONS } } }
    );

    if (result.matchedCount === 0) {
      console.log('❌ Admin role not found!');
      console.log('ℹ️  Please create an admin role first.');
    } else if (result.modifiedCount === 0) {
      console.log('ℹ️  All permissions already exist in admin role');
    } else {
      console.log(`✅ Added ${NEW_PERMISSIONS.length} new permissions to admin role`);
    }

    // Verify the permissions were added
    const adminRole = await rolesCollection.findOne({ name: 'admin' }) as Role | null;
    if (adminRole) {
      console.log('\n📋 Admin role permissions count:', adminRole.permissions.length);
      
      const missingPermissions = NEW_PERMISSIONS.filter(p => !adminRole.permissions.includes(p));
      if (missingPermissions.length === 0) {
        console.log('✅ All new permissions are present');
      } else {
        console.log('⚠️  Missing permissions:', missingPermissions);
      }
      
      // Show new permissions added
      console.log('\n📝 New permissions added:');
      NEW_PERMISSIONS.forEach(p => {
        const status = adminRole.permissions.includes(p) ? '✅' : '❌';
        console.log(`   ${status} ${p}`);
      });
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Disconnected from MongoDB');
    process.exit(0);
  }
}

addNewPermissions();
