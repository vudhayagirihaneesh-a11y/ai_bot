const { spawn, execSync } = require('child_process');
const http = require('http');
const fs = require('fs');

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
    req.on('error', (e) => resolve({ citations, answer: 'ERR: ' + e.message }));
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

const log = (msg) => { process.stdout.write(msg + '\n'); fs.appendFileSync('test_results.txt', msg + '\n'); };

(async () => {
  fs.writeFileSync('test_results.txt', '');
  
  // Step 1: Kill existing servers (but not ourselves)
  log('Step 1: Cleaning up old servers...');
  try { 
    // Only kill processes listening on port 3000, not all node processes
    execSync('netstat -ano | findstr :3000 | findstr LISTENING', { stdio: 'pipe' });
  } catch(e) {}
  // Kill any node processes with 'next' in command line
  try { execSync('wsk process where "cmdline like \'%next%\'" delete 2>&1', { stdio: 'ignore' }); } catch(e) {}
  await new Promise(r => setTimeout(r, 2000));
  
  // Step 2: Start server using PowerShell to avoid process tree issues
  log('Step 2: Starting dev server via PowerShell...');
  const psScript = `
$proc = Start-Process -FilePath 'npm' -ArgumentList 'run','dev' -WindowStyle Hidden -PassThru -RedirectStandardOutput 'nul' -RedirectStandardError 'nul'
Write-Output $proc.Id
`;
  const psPath = 'C:\\Users\\vudha\\Downloads\\ai_bot\\_start.ps1';
  fs.writeFileSync(psPath, psScript);
  
  // Run PowerShell to start the server detached
  const starter = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psPath], {
    stdio: 'ignore',
    detached: true,
    shell: false
  });
  starter.unref();
  
  // Wait a moment and read the PID file
  await new Promise(r => setTimeout(r, 2000));
  let serverPid = 'unknown';
  try {
    // Check if server started by looking at port
    await new Promise(r => setTimeout(r, 5000));
  } catch(e) {}
  log('  Server starting...');
  
  // Step 3: Wait for server
  log('Step 3: Waiting for server...');
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const h = await health();
    if (h?.ollama?.alive && h?.index?.chunks > 0) { ready = true; break; }
    await new Promise(r => setTimeout(r, 2000));
  }
  if (!ready) { 
    log('ERROR: Server did not start in 120s');
    try { fs.unlinkSync(psPath); } catch(e) {}
    process.exit(1); 
  }
  log('  Ready! Chunks=' + (await health())?.index?.chunks);
  
  // Step 4: Run tests
  log('\nStep 4: Running tests...\n');
  const tests = [
    ['What is the 50/10 rule for studying?', '50/10 rule'],
    ['What is the quadratic formula?', 'Quad formula'],
    ['What is the polar form of a complex number?', 'Complex numbers'],
    ['What is the binomial theorem?', 'Binomial theorem'],
  ];
  const all = [];
  for (const [q, label] of tests) {
    log('=== ' + label + ' ===');
    const r = await chat(q);
    log('Citations: ' + r.citations.length);
    r.citations.forEach(c => log('  - ' + c.docName + ' score=' + c.score));
    log('Answer: ' + r.answer.substring(0, 200));
    log('');
    all.push(...r.citations);
  }
  const textHits = all.filter(c => c.docName?.includes('math_ai'));
  const rosenHits = all.filter(c => c.docName?.includes('Rosen'));
  log('=== FINAL RESULT ===');
  log('Total: ' + all.length);
  log('math_ai_master_system.txt: ' + textHits.length);
  log('Kenneth H Rosen.pdf: ' + rosenHits.length);
  log(textHits.length > 0 ? '\n*** SUCCESS: Text file is read! ***' : '\n*** ISSUE: Text file not retrieved ***');
  
  // Cleanup
  ['_start.ps1','verify_fix.mjs','verify_out.txt','verify_out2.txt','verify_final.txt','run_test.mjs','start_server.ps1'].forEach(f => {
    try { fs.unlinkSync(f); } catch(e) {}
  });
  
  process.exit(0);
})();