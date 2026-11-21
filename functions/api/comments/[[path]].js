import { handle } from '../../../server/comments/http.js';
import { publicComments } from '../../../server/comments/public.js';

export const onRequest = context => handle(() => publicComments(context));
