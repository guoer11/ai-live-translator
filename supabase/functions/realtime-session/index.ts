import { createHandler } from './handler.js';
Deno.serve(createHandler({ env: (name: string) => Deno.env.get(name) }));
