import http from 'http';

const payload = JSON.stringify({
  message: 'Summarize the key points from my documents'
});

const req = http.request('http://localhost:3000/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
}, (res) => {
  console.log('STATUS:', res.statusCode);
  let fullText = '';
  res.setEncoding('utf8');
  res.on('data', (chunk) => {
    fullText += chunk;
    // Parse SSE events - each line starts with "data: "
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === 'token') process.stdout.write(event.value);
          else if (event.type === 'status') console.log('\n[STATUS] ' + JSON.stringify(event));
          else if (event.type === 'citations') console.log('\n[CITATIONS] ' + JSON.stringify(event));
          else if (event.type === 'done') console.log('\n[DONE]');
        } catch (e) { /* skip parse errors */ }
      }
    }
  });
  res.on('end', () => {
    console.log('\n--- DONE ---');
  });
});
req.on('error', (e) => { console.log('ERR:', e.message); });
req.write(payload);
req.end();