import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { isRocketChatAdmin, isChannelAdminOrOwner } from '../utils/rocketchat-auth';
import { log } from '../utils/logger';

/**
 * Middleware to check if user is a Rocket.Chat administrator
 */
export function requireRocketChatAdmin() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid access token'
      });
    }

    const { userId, workspaceId, username } = req.user;

    try {
      log.info('Checking admin permissions', { userId, workspaceId, username });

      const isAdmin = await isRocketChatAdmin(workspaceId, userId, username);

      if (!isAdmin) {
        log.warn('Admin access denied', { userId, workspaceId, username });
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'This action requires administrator privileges. Only Rocket.Chat administrators can access this resource.'
        });
      }

      log.info('Admin access granted', { userId, workspaceId, username });
      next();
    } catch (error) {
      log.error('Error checking admin permissions', {
        userId,
        workspaceId,
        username,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return res.status(500).json({
        error: 'Authorization check failed',
        message: 'Unable to verify administrator privileges. Please try again later.'
      });
    }
  };
}

/**
 * Middleware to check if user is channel admin/owner or global admin
 */
export function requireChannelAdminOrOwner() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid access token'
      });
    }

    const { userId, workspaceId, username } = req.user;
    const { channelId } = req.params;

    if (!channelId) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'Channel ID is required in the URL parameters'
      });
    }

    try {
      log.info('Checking channel permissions', {
        userId,
        workspaceId,
        channelId,
        username
      });

      const hasPermission = await isChannelAdminOrOwner(workspaceId, channelId, userId, username);

      if (!hasPermission) {
        log.warn('Channel access denied', {
          userId,
          workspaceId,
          channelId,
          username
        });
        return res.status(403).json({
          error: 'Insufficient permissions',
          message: 'This action requires channel administrator or owner privileges. You must be a channel owner, moderator, or global administrator to modify channel settings.'
        });
      }

      log.info('Channel access granted', {
        userId,
        workspaceId,
        channelId,
        username
      });
      next();
    } catch (error) {
      log.error('Error checking channel permissions', {
        userId,
        workspaceId,
        channelId,
        username,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return res.status(500).json({
        error: 'Authorization check failed',
        message: 'Unable to verify channel permissions. Please try again later.'
      });
    }
  };
}

/**
 * Middleware to check if user can access channel configuration (read-only check)
 * Less strict than admin check - allows any channel member to read config
 */
export function requireChannelAccess() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide a valid access token'
      });
    }

    const { userId, workspaceId, username } = req.user;
    const { channelId } = req.params;

    if (!channelId) {
      return res.status(400).json({
        error: 'Bad request',
        message: 'Channel ID is required in the URL parameters'
      });
    }

    try {
      log.info('Checking channel access', {
        userId,
        workspaceId,
        channelId,
        username
      });

      // For now, we'll use the same check as admin. In the future, this could be
      // expanded to check if user is just a member of the channel
      const hasAccess = await isChannelAdminOrOwner(workspaceId, channelId, userId, username);

      if (!hasAccess) {
        log.warn('Channel access denied', {
          userId,
          workspaceId,
          channelId,
          username
        });
        return res.status(403).json({
          error: 'Access denied',
          message: 'You do not have access to this channel configuration. You must be a member of the channel to view its settings.'
        });
      }

      log.info('Channel access granted', {
        userId,
        workspaceId,
        channelId,
        username
      });
      next();
    } catch (error) {
      log.error('Error checking channel access', {
        userId,
        workspaceId,
        channelId,
        username,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return res.status(500).json({
        error: 'Access check failed',
        message: 'Unable to verify channel access. Please try again later.'
      });
    }
  };
}

/**
 * Error handler specifically for authorization failures
 * This can be used to standardize authorization error responses
 */
export function handleAuthorizationError(error: Error, req: AuthRequest, res: Response, next: NextFunction) {
  if (error.name === 'AuthorizationError') {
    log.warn('Authorization error', {
      userId: req.user?.userId,
      workspaceId: req.user?.workspaceId,
      path: req.path,
      method: req.method,
      error: error.message
    });

    return res.status(403).json({
      error: 'Authorization failed',
      message: error.message || 'You do not have permission to perform this action'
    });
  }

  next(error);
}