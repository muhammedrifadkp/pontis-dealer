// Every /api/* request goes to the handler in lib/server.js
import { handle } from '../../lib/server.js';

export const onRequest = context => handle(context);
