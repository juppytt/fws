import type { Request, Response, NextFunction } from 'express';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error('[fws] Error:', err.message);
  res.status(500).json({
    error: {
      code: 500,
      message: err.message,
      status: 'INTERNAL',
    },
  });
}

export function notFoundError(message: string): { status: number; body: object } {
  return {
    status: 404,
    body: {
      error: {
        code: 404,
        message,
        status: 'NOT_FOUND',
      },
    },
  };
}

export function badRequestError(message: string): { status: number; body: object } {
  return {
    status: 400,
    body: {
      error: {
        code: 400,
        message,
        status: 'INVALID_ARGUMENT',
      },
    },
  };
}
