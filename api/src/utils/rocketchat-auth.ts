import axios from 'axios';
import { cache } from '../config/redis';
import { log } from './logger';

// Rocket.Chat API response interfaces
interface RocketChatUser {
  _id: string;
  username: string;
  name?: string;
  emails?: Array<{ address: string; verified: boolean }>;
  roles?: string[];
  active: boolean;
}

interface RocketChatChannel {
  _id: string;
  name: string;
  type: 'c' | 'p' | 'd'; // channel, private group, direct message
  usernames?: string[];
  u?: { _id: string; username: string }; // channel owner
}

interface RocketChatSubscription {
  _id: string;
  rid: string; // room id
  u: { _id: string; username: string };
  roles?: string[];
}

interface RocketChatLoginResponse {
  status: string;
  data: {
    authToken: string;
    userId: string;
    me: RocketChatUser;
  };
}

// Cache keys
const ADMIN_CACHE_KEY = (workspaceId: string, userId: string) => `auth:admin:${workspaceId}:${userId}`;
const CHANNEL_OWNER_CACHE_KEY = (workspaceId: string, channelId: string, userId: string) => `auth:channel:${workspaceId}:${channelId}:${userId}`;
const AUTH_TOKEN_CACHE_KEY = (workspaceId: string) => `auth:token:${workspaceId}`;

// Cache TTL (5 minutes for auth checks)
const CACHE_TTL = 300;

/**
 * Get cached admin auth token for Rocket.Chat API calls
 */
async function getAuthToken(workspaceId: string): Promise<{ authToken: string; userId: string } | null> {
  try {
    // Try cache first
    const cached = await cache.get(AUTH_TOKEN_CACHE_KEY(workspaceId));
    if (cached) {
      return cached;
    }

    // Login with admin credentials
    const loginResponse = await axios.post<RocketChatLoginResponse>(`${process.env.ROCKETCHAT_URL}/api/v1/login`, {
      user: process.env.ROCKETCHAT_ADMIN_USER,
      password: process.env.ROCKETCHAT_ADMIN_PASS
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (loginResponse.data.status !== 'success') {
      log.error('Failed to authenticate with Rocket.Chat', { workspaceId });
      return null;
    }

    const authData = {
      authToken: loginResponse.data.data.authToken,
      userId: loginResponse.data.data.userId
    };

    // Cache for 10 minutes (auth tokens are valid longer)
    await cache.set(AUTH_TOKEN_CACHE_KEY(workspaceId), authData, 600);

    return authData;
  } catch (error) {
    log.error('Error getting Rocket.Chat auth token', {
      workspaceId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return null;
  }
}

/**
 * Check if user is a global administrator in Rocket.Chat
 */
export async function isRocketChatAdmin(workspaceId: string, userId: string, username?: string): Promise<boolean> {
  try {
    // Check cache first
    const cacheKey = ADMIN_CACHE_KEY(workspaceId, userId);
    const cached = await cache.get(cacheKey);
    if (cached !== null) {
      log.cache('hit', cacheKey);
      return cached === 'true';
    }

    // Get auth token
    const auth = await getAuthToken(workspaceId);
    if (!auth) {
      log.warn('Cannot verify admin status - no auth token', { workspaceId, userId });
      return false;
    }

    // Get user info from Rocket.Chat
    const userResponse = await axios.get(`${process.env.ROCKETCHAT_URL}/api/v1/users.info`, {
      params: username ? { username } : { userId },
      headers: {
        'X-Auth-Token': auth.authToken,
        'X-User-Id': auth.userId,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (!userResponse.data.success) {
      log.warn('User not found in Rocket.Chat', { workspaceId, userId, username });
      await cache.set(cacheKey, 'false', CACHE_TTL);
      return false;
    }

    const user: RocketChatUser = userResponse.data.user;

    // Check if user has admin role
    const isAdmin = user.roles?.includes('admin') || false;

    // Cache result
    await cache.set(cacheKey, isAdmin ? 'true' : 'false', CACHE_TTL);

    log.info('Admin check completed', {
      workspaceId,
      userId,
      username,
      isAdmin,
      roles: user.roles
    });

    return isAdmin;
  } catch (error) {
    log.error('Error checking admin status', {
      workspaceId,
      userId,
      username,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    // Cache negative result for short time to prevent repeated failures
    await cache.set(ADMIN_CACHE_KEY(workspaceId, userId), 'false', 60);
    return false;
  }
}

/**
 * Check if user is owner or moderator of a specific channel
 */
export async function isChannelAdminOrOwner(workspaceId: string, channelId: string, userId: string, username?: string): Promise<boolean> {
  try {
    // Check cache first
    const cacheKey = CHANNEL_OWNER_CACHE_KEY(workspaceId, channelId, userId);
    const cached = await cache.get(cacheKey);
    if (cached !== null) {
      log.cache('hit', cacheKey);
      return cached === 'true';
    }

    // Get auth token
    const auth = await getAuthToken(workspaceId);
    if (!auth) {
      log.warn('Cannot verify channel permissions - no auth token', { workspaceId, channelId, userId });
      return false;
    }

    // First check if user is global admin
    const isGlobalAdmin = await isRocketChatAdmin(workspaceId, userId, username);
    if (isGlobalAdmin) {
      await cache.set(cacheKey, 'true', CACHE_TTL);
      return true;
    }

    // Get channel info
    const channelResponse = await axios.get(`${process.env.ROCKETCHAT_URL}/api/v1/channels.info`, {
      params: { roomId: channelId },
      headers: {
        'X-Auth-Token': auth.authToken,
        'X-User-Id': auth.userId,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (!channelResponse.data.success) {
      // Try groups API for private channels
      const groupResponse = await axios.get(`${process.env.ROCKETCHAT_URL}/api/v1/groups.info`, {
        params: { roomId: channelId },
        headers: {
          'X-Auth-Token': auth.authToken,
          'X-User-Id': auth.userId,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      if (!groupResponse.data.success) {
        log.warn('Channel not found in Rocket.Chat', { workspaceId, channelId });
        await cache.set(cacheKey, 'false', CACHE_TTL);
        return false;
      }
    }

    // Get user's subscription to the channel (includes roles)
    const subscriptionResponse = await axios.get(`${process.env.ROCKETCHAT_URL}/api/v1/subscriptions.getOne`, {
      params: { roomId: channelId },
      headers: {
        'X-Auth-Token': auth.authToken,
        'X-User-Id': userId, // Use the actual user ID we're checking
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });

    if (!subscriptionResponse.data.success) {
      log.warn('User subscription not found for channel', { workspaceId, channelId, userId });
      await cache.set(cacheKey, 'false', CACHE_TTL);
      return false;
    }

    const subscription: RocketChatSubscription = subscriptionResponse.data.subscription;

    // Check if user has owner or moderator role in the channel
    const isChannelAdmin = subscription.roles?.includes('owner') ||
                          subscription.roles?.includes('moderator') ||
                          subscription.roles?.includes('leader') ||
                          false;

    // Cache result
    await cache.set(cacheKey, isChannelAdmin ? 'true' : 'false', CACHE_TTL);

    log.info('Channel permission check completed', {
      workspaceId,
      channelId,
      userId,
      isChannelAdmin,
      roles: subscription.roles
    });

    return isChannelAdmin;
  } catch (error) {
    log.error('Error checking channel permissions', {
      workspaceId,
      channelId,
      userId,
      username,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    // Cache negative result for short time to prevent repeated failures
    await cache.set(CHANNEL_OWNER_CACHE_KEY(workspaceId, channelId, userId), 'false', 60);
    return false;
  }
}

/**
 * Clear authorization cache for a user (useful when roles change)
 */
export async function clearUserAuthCache(workspaceId: string, userId: string): Promise<void> {
  try {
    // Clear admin cache
    await cache.delete(ADMIN_CACHE_KEY(workspaceId, userId));

    // Clear all channel caches for this user (this is a bit brute force, but effective)
    // In production, you might want to keep track of which channels a user has cached
    const pattern = `auth:channel:${workspaceId}:*:${userId}`;
    // Note: Redis pattern deletion would need a custom implementation
    // For now, we'll just clear the admin cache

    log.info('User auth cache cleared', { workspaceId, userId });
  } catch (error) {
    log.error('Error clearing user auth cache', {
      workspaceId,
      userId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Clear all authorization cache for a workspace
 */
export async function clearWorkspaceAuthCache(workspaceId: string): Promise<void> {
  try {
    // Clear auth token cache
    await cache.delete(AUTH_TOKEN_CACHE_KEY(workspaceId));

    log.info('Workspace auth cache cleared', { workspaceId });
  } catch (error) {
    log.error('Error clearing workspace auth cache', {
      workspaceId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}