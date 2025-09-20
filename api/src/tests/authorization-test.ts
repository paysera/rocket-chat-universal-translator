/**
 * Simple test script to validate authorization implementation
 * This should be run with proper environment variables set
 */

import { isRocketChatAdmin, isChannelAdminOrOwner } from '../utils/rocketchat-auth';
import { log } from '../utils/logger';

// Test configuration
const TEST_WORKSPACE_ID = 'test-workspace';
const TEST_USER_ID = 'test-user';
const TEST_USERNAME = 'test-username';
const TEST_CHANNEL_ID = 'test-channel';

async function testAuthorization() {
  console.log('🔐 Starting authorization tests...\n');

  try {
    // Test 1: Check admin status
    console.log('Test 1: Checking admin status...');
    const isAdmin = await isRocketChatAdmin(TEST_WORKSPACE_ID, TEST_USER_ID, TEST_USERNAME);
    console.log(`Result: User ${TEST_USERNAME} is admin: ${isAdmin}\n`);

    // Test 2: Check channel permissions
    console.log('Test 2: Checking channel permissions...');
    const hasChannelAccess = await isChannelAdminOrOwner(TEST_WORKSPACE_ID, TEST_CHANNEL_ID, TEST_USER_ID, TEST_USERNAME);
    console.log(`Result: User ${TEST_USERNAME} has channel admin access: ${hasChannelAccess}\n`);

    console.log('✅ Authorization tests completed successfully');

  } catch (error) {
    console.error('❌ Authorization tests failed:', error);
    log.error('Authorization test error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Export for potential use in other test files
export { testAuthorization };

// Run tests if this file is executed directly
if (require.main === module) {
  testAuthorization();
}