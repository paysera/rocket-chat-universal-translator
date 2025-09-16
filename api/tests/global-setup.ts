import { execSync } from 'child_process';
import path from 'path';

export default async function globalSetup() {
  console.log('Setting up test environment...');

  // Start test services
  try {
    console.log('Starting test services...');
    execSync('docker-compose -f docker-compose.test.yml up -d', {
      cwd: path.resolve(__dirname, '../..')
    });

    // Wait for services to be ready
    console.log('Waiting for services to be ready...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // Setup test database
    console.log('Setting up test database...');
    const setupScript = path.join(__dirname, '../scripts/setup-test-db.sh');
    execSync(`chmod +x "${setupScript}" && "${setupScript}"`, {
      cwd: path.resolve(__dirname, '..')
    });

    console.log('Test environment setup complete!');
  } catch (error) {
    console.error('Failed to setup test environment:', error);
    throw error;
  }
}