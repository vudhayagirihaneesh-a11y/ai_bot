import http from 'http';

function chat(question) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ message: question });
    const req = http.request({
      hostname: 'localhost', port: 3000, path: '/api/chat', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 120000
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c.toString());
      res.on('end', () => {
        const lines = data.split('\n').filter(l => l.startsWith('data: '));
        const events = lines.map(l => { try { return JSON.parse(l.substring(6)) } catch(e) { return null } }).filter(Boolean);
        const statusEvents = events.filter(e => e.type === 'status').map(e => e.stage);
        const citations = events.find(e => e.type === 'citations')?.citations || [];
        const tokens = events.filter(e => e.type === 'token').map(e => e.value);
        resolve({ statusEvents, citations, answer: tokens.join('') });
      });
    });
    req.on('error', (e) => resolve({ statusEvents: [], citations: [], answer: 'ERR: ' + e.message }));
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('=== TEST 1: "Summarize key points from my documents" ===');
  const r1 = await chat('Summarize key points from my documents');
  console.log('Stages:', r1.statusEvents.join(' -> '));
  console.log('Citations:', r1.citations.length);
  r1.citations.forEach(c => console.log('  -', c.docName, 'score=' + c.score, 'page=' + c.page));
  console.log('Answer:', r1.answer.substring(0, 300));
  const usedWeb1 = r1.citations.some(c => c.source === 'web');
  console.log('Used web?', usedWeb1, '(should be FALSE)');

  console.log('');
  console.log('=== TEST 2: "What is goodbye?" ===');
  const r2 = await chat('What is goodbye?');
  console.log('Stages:', r2.statusEvents.join(' -> '));
  console.log('Citations:', r2.citations.length);
  r2.citations.forEach(c => console.log('  -', c.docName, 'score=' + c.score));
  console.log('Answer:', r2.answer.substring(0, 200));

  console.log('');
  console.log('=== TEST 3: "What is the 50/10 rule?" ===');
  const r3 = await chat('What is the 50/10 rule?');
  console.log('Stages:', r3.statusEvents.join(' -> '));
  console.log('Citations:', r3.citations.length);
  r3.citations.forEach(c => console.log('  -', c.docName, 'score=' + c.score));
  console.log('Answer:', r3.answer.substring(0, 200));

  process.exit(0);
})();
