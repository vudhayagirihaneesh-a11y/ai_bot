import http from 'http';
const req = http.get('http://localhost:3000/api/health', (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('BODY:', data);
  });
});
req.on('error', (e) => {
  console.log('ERR:', e.message);
});