const http = require('http');

const data = JSON.stringify({
  email: 'client@test.com',
  password: 'password123'
});

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

console.log('Testing login...\n');

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    try {
      const result = JSON.parse(body);
      console.log('Response:', JSON.stringify(result, null, 2));
      if (res.statusCode === 200 && result.token) {
        console.log('\n✅ LOGIN SUCCESSFUL!');
      } else {
        console.log('\n❌ LOGIN FAILED!');
      }
    } catch (e) {
      console.log('Response:', body);
    }
    process.exit(0);
  });
});

req.on('error', err => {
  console.error('Error:', err.code || err.message);
  process.exit(1);
});
req.write(data);
req.end();
