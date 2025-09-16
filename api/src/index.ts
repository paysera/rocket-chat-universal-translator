// Re-export main server
export { Server } from './server';

// Start server if this is the main module
if (require.main === module) {
  const { Server } = require('./server');
  const server = new Server();
  server.start().catch(console.error);
}