const mongoose = require('mongoose');
const User = require('./models/User');

async function testSeed() {
  try {
    // Connect to MongoDB
    await mongoose.connect('mongodb://127.0.0.1:27017/patanjali', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ MongoDB Connected\n');

    // Clear users
    await User.deleteMany({});
    console.log('🗑️  Cleared existing users\n');

    // Create test users
    const users = await User.create([
      {
        name: 'Client User',
        email: 'client@test.com',
        password: 'password123',
        role: 'client'
      },
      {
        name: 'Admin User',
        email: 'admin@test.com',
        password: 'admin123',
        role: 'admin'
      }
    ]);

    console.log('✅ Users Created Successfully!\n');
    console.log('📋 CLIENT USER:');
    console.log('   Email: client@test.com');
    console.log('   Password: password123');
    console.log('   Role: client\n');

    console.log('📋 ADMIN USER:');
    console.log('   Email: admin@test.com');
    console.log('   Password: admin123');
    console.log('   Role: admin\n');

    // Verify users in database
    const allUsers = await User.find({});
    console.log('📊 Users in Database:', allUsers.length);
    allUsers.forEach(user => {
      console.log(`   - ${user.email} (${user.role})`);
    });

    console.log('\n✅ Test data seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

testSeed();
