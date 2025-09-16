import { execSync } from 'child_process';
import path from 'path';

export default async function globalTeardown() {
  console.log('Tearing down test environment...');

  try {
    // Stop test services
    execSync('docker-compose -f docker-compose.test.yml down', {
      cwd: path.resolve(__dirname, '../..')
    });
    console.log('Test environment teardown complete!');
  } catch (error) {
    console.error('Failed to teardown test environment:', error);
  }
}