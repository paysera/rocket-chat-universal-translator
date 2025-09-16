import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        userId: string;
        workspaceId: string;
        username?: string;
        role?: string;
        subscription?: string;
      };
    }
  }
}

export interface AuthRequest extends Request {
  user: {
    id: string;
    userId: string;
    workspaceId: string;
    username?: string;
    role?: string;
    subscription?: string;
  };
}