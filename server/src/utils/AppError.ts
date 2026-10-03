export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly errors: FieldError[] = [],
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message = 'Bad request', errors: FieldError[] = []) {
    return new AppError(400, message, errors, 'BAD_REQUEST');
  }
  static validation(errors: FieldError[], message = 'Validation failed') {
    return new AppError(422, message, errors, 'VALIDATION_ERROR');
  }
  static unauthorized(message = 'Authentication required') {
    return new AppError(401, message, [], 'UNAUTHORIZED');
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new AppError(403, message, [], 'FORBIDDEN');
  }
  static notFound(message = 'Resource not found') {
    return new AppError(404, message, [], 'NOT_FOUND');
  }
  static conflict(message = 'Resource already exists') {
    return new AppError(409, message, [], 'CONFLICT');
  }
}
