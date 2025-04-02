// import { spawn } from 'child_process';
const { spawn } = require('child_process');
const { join } = require('path');
const front_dev = 'cd front && npm run dev';
const dev_app = 'npm run dev-app';
const allocProcess = (command, cwd) => {
  const [cmd, ...rest] = command.split(' ');
  console.log({ command, cwd });
  const pro = spawn(cmd, rest || [], {
    cwd,
    shell: true,
    stdio: 'pipe',
  });
  pro.stdout.on('data', data => {
    console.info(Buffer.from(data).toString());
  });
  pro.stderr.on('error', data => {
    console.error(Buffer.from(data).toString());
  });
};

allocProcess(dev_app, join(__dirname, '/'));
allocProcess(front_dev, join(__dirname, '/'));

// allocProcess('node -v');
