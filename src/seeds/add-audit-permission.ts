// Run this script to add audit:read permission to admin role
// Usage: npx ts-node src/seeds/add-audit-permission.ts

import mongoose from 'mongoose';
import { config } from 'dotenv';

config();

interface Role {
  name: string;
  permissions: string[];
}

async function addAuditPermission() {
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

    // Add audit:read permission to admin role
    const result = await rolesCollection.updateOne(
      { name: 'admin' },
      { $addToSet: { permissions: 'audit:read' } }
    );

    if (result.matchedCount === 0) {
      console.log('❌ Admin role not found!');
    } else if (result.modifiedCount === 0) {
      console.log('ℹ️  Permission already exists in admin role');
    } else {
      console.log('✅ Added audit:read permission to admin role');
    }

    // Verify the permission was added
    const adminRole = await rolesCollection.findOne({ name: 'admin' }) as Role | null;
    if (adminRole) {
      console.log('\n📋 Admin role permissions:');
      console.log(adminRole.permissions);
      
      const hasAuditRead = adminRole.permissions.includes('audit:read');
      console.log(`\n${hasAuditRead ? '✅' : '❌'} audit:read permission: ${hasAuditRead ? 'PRESENT' : 'MISSING'}`);
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

addAuditPermission();
