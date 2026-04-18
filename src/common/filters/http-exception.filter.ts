import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let code = 'INTERNAL_ERROR';
    let field: string | undefined;
    let errors: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'string') {
        message = res;
        code = toCode(res);
      } else if (typeof res === 'object' && res !== null) {
        const r = res as Record<string, any>;
        // class-validator returns { message: string[] }
        if (Array.isArray(r.message)) {
          errors = r.message;
          message = r.message[0];
        } else {
          message = r.message ?? message;
        }
        code = r.code ?? toCode(message);
        field = r.field;
      }
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      code,
      ...(field ? { field } : {}),
      ...(errors ? { errors } : {}),
      timestamp: new Date().toISOString(),
    });
  }
}

/** Converts a human-readable message to an UPPER_SNAKE_CASE code */
function toCode(msg: string): string {
  return msg
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 50);
}
