import { writeFileSync } from 'node:fs';
import { config } from '../dist/config.js';
const endpoint = process.env.TRANSLATOR_SESSION_ENDPOINT || config.sessionEndpoint || '';
if (!endpoint) throw new Error('Set repository variable TRANSLATOR_SESSION_ENDPOINT before deploying.');
const url = new URL(endpoint);
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/functions/v1/realtime-session')) throw new Error('Expected HTTPS Supabase realtime-session URL without credentials/query.');
writeFileSync(new URL('../dist/config.js', import.meta.url), `// Public URL only. No secrets.\nexport const config = Object.freeze(${JSON.stringify({ sessionEndpoint: endpoint })});\n`);
