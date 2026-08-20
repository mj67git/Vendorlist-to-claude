const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/vendors',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.on('data', (chunk) => {
    console.log(`BODY: ${chunk}`);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(JSON.stringify({
    id: "v" + Math.random(),
    material: "Test",
    materialEn: "TestEn",
    cas: "N/A",
    irc: "N/A",
    name: "TestVendor",
    nameEn: "TestVendorEn",
    country: "IR",
    status: "new",
    grade: "new",
    isSample: false,
    category: "domestic"
  }));
req.end();
