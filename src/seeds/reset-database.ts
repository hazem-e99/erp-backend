// Run this script to reset the database, keeping only Osama@intlakaa.com user and all roles/permissions
// Usage: npx ts-node src/seeds/reset-database.ts

import mongoose from 'mongoose';
import * as bcrypt from 'bcrypt';
import { config } from 'dotenv';
import * as dns from 'dns';

config();

// Force Google DNS for MongoDB Atlas SRV resolution
dns.setServers(['8.8.8.8', '8.8.4.4']);

const KEEP_USER_EMAIL = 'Osama@intlakaa.com';
const KEEP_USER_PASSWORD = 'Osama@123';
const KEEP_USER_NAME = 'Osama';

async function resetDatabase() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/erp';
  
  try {
    // Connect to MongoDB
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

    // Get all collections
    const collections = await db.listCollections().toArray();
    console.log('\n📋 Found collections:', collections.map(c => c.name).join(', '));

    // Collections to keep data in
    const keepCollections = ['roles'];
    
    // Collections to clear completely (except users which we'll handle specially)
    const collectionsToProcess = collections.filter(c => 
      !keepCollections.includes(c.name) && c.name !== 'users'
    );

    // Clear all collections except roles and users
    console.log('\n🗑️  Clearing collections...');
    for (const collection of collectionsToProcess) {
      const result = await db.collection(collection.name).deleteMany({});
      console.log(`   ✅ Cleared ${collection.name}: ${result.deletedCount} documents deleted`);
    }

    // Handle users collection - keep only Osama@intlakaa.com
    console.log('\n👤 Processing users collection...');
    const usersCollection = db.collection('users');
    
    // Check if the user exists
    let keepUser = await usersCollection.findOne({ email: KEEP_USER_EMAIL });
    
    if (keepUser) {
      console.log(`   ℹ️  Found user: ${KEEP_USER_EMAIL}`);
      
      // Delete all other users
      const deleteResult = await usersCollection.deleteMany({ email: { $ne: KEEP_USER_EMAIL } });
      console.log(`   ✅ Deleted ${deleteResult.deletedCount} other users`);
      
      // Update the password for the kept user
      const hashedPassword = await bcrypt.hash(KEEP_USER_PASSWORD, 10);
      await usersCollection.updateOne(
        { email: KEEP_USER_EMAIL },
        { 
          $set: { 
            password: hashedPassword,
            name: KEEP_USER_NAME,
            isActive: true
          } 
        }
      );
      console.log(`   ✅ Updated password for ${KEEP_USER_EMAIL}`);
    } else {
      console.log(`   ℹ️  User ${KEEP_USER_EMAIL} not found, deleting all users and creating new one...`);
      
      // Delete all users
      const deleteResult = await usersCollection.deleteMany({});
      console.log(`   ✅ Deleted ${deleteResult.deletedCount} users`);
      
      // Create the new user
      const hashedPassword = await bcrypt.hash(KEEP_USER_PASSWORD, 10);
      
      // Get admin role if exists
      const rolesCollection = db.collection('roles');
      const adminRole = await rolesCollection.findOne({ name: 'admin' });
      
      await usersCollection.insertOne({
        name: KEEP_USER_NAME,
        email: KEEP_USER_EMAIL,
        password: hashedPassword,
        role: adminRole?._id || null,
        isActive: true,
        avatar: null,
        phone: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      console.log(`   ✅ Created new user: ${KEEP_USER_EMAIL}`);
    }

    // Summary
    console.log('\n✅ Database reset complete!');
    console.log('\n📊 Summary:');
    console.log(`   - Kept collections: ${keepCollections.join(', ')}`);
    console.log(`   - Cleared collections: ${collectionsToProcess.map(c => c.name).join(', ')}`);
    console.log(`   - Kept user: ${KEEP_USER_EMAIL}`);
    console.log(`   - Password: ${KEEP_USER_PASSWORD}`);
    
    // Show roles count
    const rolesCollection = db.collection('roles');
    const rolesCount = await rolesCollection.countDocuments();
    console.log(`   - Roles preserved: ${rolesCount}`);

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

resetDatabase();
