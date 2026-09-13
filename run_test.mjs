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
        const citations = events.find(e => e.type === 'citations')?.citations || [];
        const tokens = events.filter(e => e.type === 'token').map(e => e.value);
        resolve({ citations, answer: tokens.join('') });
      });
    });
    req.on('error', (e) => resolve({ citations: [], answer: 'ERR: ' + e.message }));
    req.write(body);
    req.end();
  });
}

function health() {
  return new Promise((resolve) => {
    http.get('http://localhost:3000/api/health', (res) => {
      let data = '';
      res.on('data', (c) => data += c.toString());
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch(e) { resolve(null) } });
    }).on('error', () => resolve(null));
  });
}

const log = (msg) => process.stdout.write(msg + '\n');

(async () => {
  // Check server is running
  log('Checking server...');
  const h = await health();
  if (!h) { log('ERROR: Server not running. Run "npm run dev" first.'); process.exit(1); }
  log('Server ready! Chunks=' + (h.index?.chunks || '?'));

  const tests = [
    ['What is the 50/10 rule for studying?', '50/10 rule'],
    ['What is the quadratic formula?', 'Quadratic formula'],
    ['What is the polar form of a complex number?', 'Complex numbers'],
    ['What is the binomial theorem?', 'Binomial theorem'],
  ];
  const all = [];
  for (const [q, label] of tests) {
    log('\n=== ' + label + ' ===');
    const r = await chat(q);
    log('Citations: ' + r.citations.length);
    r.citations.forEach(c => log('  - ' + c.docName + ' score=' + c.score));
    log('Answer: ' + r.answer.substring(0, 200));
    all.push(...r.citations);
  }
  const textHits = all.filter(c => c.docName?.includes('math_ai'));
  const rosenHits = all.filter(c => c.docName?.includes('Rosen'));
  log('\n=== RESULT ===');
  log('math_ai_master_system.txt: ' + textHits.length);
  log('Kenneth H Rosen.pdf: ' + rosenHits.length);
  log(textHits.length > 0 ? 'SUCCESS!' : 'NOT RETRIEVED');
  process.exit(0);
})();
