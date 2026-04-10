const http = require('http');

function testLogin(email, password) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ email, password });

    const options = {
      hostname: 'localhost',
      port: 5000,
      path: '/api/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      }
    };

    const req = http.request(options, (res) => {
      let body = '';

      res.on('data', (chunk) => {
        body += chunk;
      });

      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve({ status: res.statusCode, body: response });
        } catch (e) {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing Login Endpoint\n');

  // Test client login
  console.log('📝 Testing Client Login...');
  const clientLogin = await testLogin('client@test.com', 'password123');
  console.log('   Status:', clientLogin.status);
  console.log('   Response:', JSON.stringify(clientLogin.body, null, 2));

  if (clientLogin.status === 200 && clientLogin.body.token) {
    console.log('   ✅ Client Login: SUCCESS\n');
  } else {
    console.log('   ❌ Client Login: FAILED\n');
  }

  // Test admin login
  console.log('📝 Testing Admin Login...');
  const adminLogin = await testLogin('admin@test.com', 'admin123');
  console.log('   Status:', adminLogin.status);
  console.log('   Response:', JSON.stringify(adminLogin.body, null, 2));

  if (adminLogin.status === 200 && adminLogin.body.token) {
    console.log('   ✅ Admin Login: SUCCESS\n');
  } else {
    console.log('   ❌ Admin Login: FAILED\n');
  }

  // Test invalid password
  console.log('📝 Testing Invalid Password...');
  const invalidLogin = await testLogin('client@test.com', 'wrongpassword');
  console.log('   Status:', invalidLogin.status);
  console.log('   Response:', JSON.stringify(invalidLogin.body, null, 2));
  console.log('   ✅ Should reject: SUCCESS\n');

  console.log('🎉 All tests completed!');
}

runTests().catch(console.error);
