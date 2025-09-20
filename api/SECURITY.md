# Security Implementation

## Authorization System

This document describes the comprehensive authorization system implemented for the Rocket.Chat Universal Translator API.

### Overview

The authorization system ensures that only users with appropriate privileges can access and modify translation settings at both global and channel levels. It integrates directly with Rocket.Chat's permission system to provide secure, role-based access control.

### Components

#### 1. Rocket.Chat Authentication Utility (`src/utils/rocketchat-auth.ts`)

Core utility functions that interface with Rocket.Chat APIs to verify user permissions:

- **`isRocketChatAdmin()`**: Checks if a user has global administrator privileges
- **`isChannelAdminOrOwner()`**: Verifies channel-level permissions (owner, moderator, leader)
- **Cache management**: Implements Redis caching to reduce API calls and improve performance

#### 2. Authorization Middleware (`src/middleware/authorization.ts`)

Express middleware functions that enforce authorization policies:

- **`requireRocketChatAdmin()`**: Requires global admin privileges
- **`requireChannelAdminOrOwner()`**: Requires channel admin privileges or global admin
- **`requireChannelAccess()`**: Basic channel access check (future expansion)

#### 3. Protected Endpoints

The following endpoints are now protected with proper authorization:

##### Global Admin Required
- `GET /api/v1/preferences/workspace/languages` - View all user language preferences in workspace

##### Channel Admin/Owner Required
- `PUT /api/v1/preferences/channels/:channelId/config` - Modify channel translation settings

### Security Features

#### 1. Defense in Depth
- Multiple layers of authorization checks
- Integration with existing authentication middleware
- Proper error handling and logging

#### 2. Principle of Least Privilege
- Users can only access resources they have explicit permissions for
- Channel-level permissions are verified independently
- Global admins have access to all resources

#### 3. Secure Caching
- Authorization results are cached for performance
- Cache keys are workspace and user-specific
- Short TTL (5 minutes) for auth checks to ensure fresh permissions
- Negative results cached for shorter periods to prevent auth bypass

#### 4. Error Handling
- Detailed logging of authorization attempts
- Secure error messages that don't expose system internals
- Proper HTTP status codes (403 Forbidden for authorization failures)

### Implementation Details

#### Cache Strategy
```typescript
// Cache keys are namespaced by type and scoped to workspace/user
const ADMIN_CACHE_KEY = `auth:admin:${workspaceId}:${userId}`;
const CHANNEL_OWNER_CACHE_KEY = `auth:channel:${workspaceId}:${channelId}:${userId}`;
```

#### Authorization Flow
1. Check Redis cache for previous authorization result
2. If cache miss, authenticate with Rocket.Chat using admin credentials
3. Query Rocket.Chat APIs for user permissions
4. Cache result with appropriate TTL
5. Return authorization decision

#### Error Responses
```json
{
  "error": "Insufficient permissions",
  "message": "This action requires administrator privileges. Only Rocket.Chat administrators can access this resource."
}
```

### Security Considerations

#### 1. Admin Credential Security
- Rocket.Chat admin credentials are stored in environment variables
- Admin authentication tokens are cached and rotated automatically
- Failed authentication attempts are logged

#### 2. API Rate Limiting
- Authorization checks are subject to existing rate limiting
- Cached results reduce load on Rocket.Chat APIs
- Failed authorization attempts don't expose rate limiting information

#### 3. Audit Trail
- All authorization attempts are logged with structured data
- Failed authorization attempts include context for security monitoring
- Success/failure patterns can be analyzed for security insights

#### 4. Permission Granularity
- Global admin: Can modify any workspace or channel settings
- Channel owner: Can modify settings for owned channels only
- Channel moderator/leader: Can modify settings for moderated channels only

### Environment Variables Required

```env
ROCKETCHAT_URL=https://your-rocketchat.domain.com
ROCKETCHAT_ADMIN_USER=admin-username
ROCKETCHAT_ADMIN_PASS=admin-password
```

### Testing Authorization

A test script is provided at `src/tests/authorization-test.ts` to validate the authorization implementation:

```bash
# Run authorization tests
npm run test:auth
```

### Future Enhancements

1. **Granular Channel Permissions**: Extend to check specific channel member roles
2. **Permission Inheritance**: Implement hierarchical permission structures
3. **Audit Dashboard**: Create admin interface for viewing authorization logs
4. **Permission Delegation**: Allow admins to delegate specific permissions
5. **Multi-tenancy**: Extend authorization for multi-workspace deployments

### Threat Mitigation

| Threat | Mitigation |
|--------|------------|
| Privilege Escalation | Role-based checks against Rocket.Chat authoritative source |
| Unauthorized Access | Multi-layer authorization with proper error handling |
| Information Disclosure | Minimal error messages, comprehensive logging |
| DoS via Auth Checks | Caching strategy and rate limiting |
| Cache Poisoning | Namespace separation and TTL expiration |

### Compliance Notes

This authorization system supports compliance with:
- **SOC 2 Type II**: Access controls and monitoring
- **ISO 27001**: Information security management
- **GDPR**: Privacy by design and data protection

### Monitoring and Alerting

Recommended monitoring for the authorization system:

1. **Failed Authorization Attempts**: Alert on unusual patterns
2. **Cache Hit Rate**: Monitor performance of caching strategy
3. **API Response Times**: Track Rocket.Chat API latency
4. **Admin Token Refresh**: Monitor authentication token lifecycle

---

**Security Contact**: For security issues related to this implementation, please follow responsible disclosure practices.