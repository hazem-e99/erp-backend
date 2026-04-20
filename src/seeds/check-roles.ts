// Quick check of roles in database
import mongoose from 'mongoose';
import { config } from 'dotenv';
import * as dns from 'dns';

config();
dns.setServers(['8.8.8.8', '8.8.4.4']);

async function checkRoles() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/erp';
  
  try {
    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    if (!db) {
      throw new Error('Database connection not established');
    }

    const rolesCollection = db.collection('roles');
    const roles = await rolesCollection.find({}).toArray();
    
    console.log('\n📋 Roles in database:', roles.length);
    roles.forEach(role => {
      console.log(`   - ${role.name} (${role.permissions?.length || 0} permissions)`);
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Disconnected');
    process.exit(0);
  }
}

checkRoles();
