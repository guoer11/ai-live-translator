import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('dist/vendor/supabase', { recursive: true });
copyFileSync('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'dist/vendor/supabase/supabase.js');
copyFileSync('node_modules/@supabase/supabase-js/LICENSE', 'dist/vendor/supabase/LICENSE');
