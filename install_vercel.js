const { spawn } = require('child_process');

// Deploy to Vercel - using --confirm to skip prompts
const child = spawn('npx', ['vercel', '--confirm', '--prod'], {
  cwd: 'c:\\Users\\vudha\\Downloads\\ai_bot',
  shell: true,
  windowsHide: false,
  stdio: ['pipe', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
let timeout = setTimeout(() => {
  child.kill();
  console.log('TIMEOUT - process killed');
  console.log('STDOUT:', stdout);
  console.log('STDERR:', stderr);
}, 120000);

child.stdout.on('data', (data) => { stdout += data.toString(); process.stdout.write(data.toString()); });
child.stderr.on('data', (data) => { stderr += data.toString(); process.stderr.write(data.toString()); });

child.on('error', (err) => {
  clearTimeout(timeout);
  console.log('Spawn error:', err.message);
});

child.on('close', (code) => {
  clearTimeout(timeout);
  console.log('\n--- DONE ---');
  console.log('Exit code:', code);
  console.log('Full STDOUT:\n' + stdout);
  console.log('Full STDERR:\n' + stderr);
});