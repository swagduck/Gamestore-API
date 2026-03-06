const https = require('https');

function checkAPI() {
  const options = {
    hostname: 'gamestore-api-whwx.onrender.com',
    port: 443,
    path: '/api/games',
    method: 'GET',
    headers: {
      'User-Agent': 'Health-Check/1.0'
    }
  };

  const req = https.request(options, (res) => {
    console.log(`Status: ${res.statusCode}`);
    console.log(`Headers:`, res.headers);
    
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log(`Response length: ${data.length} characters`);
      console.log(`Response: ${data}`);
      
      if (data === '[]') {
        console.log('\n❌ PROBLEM: API returns empty array');
        console.log('This usually means:');
        console.log('1. Database connection failed');
        console.log('2. Environment variables not set');
        console.log('3. No data in database');
      }
    });
  });

  req.on('error', (e) => {
    console.error(`Request error: ${e.message}`);
  });

  req.end();
}

checkAPI();
