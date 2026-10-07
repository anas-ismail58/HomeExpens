import 'express-serve-static-core';
import type { Actor } from '../services/access.service';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: Actor;
  }
}
