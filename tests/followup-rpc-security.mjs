import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migrationsDir = path.join(root, 'supabase', 'migrations');
const files = fs.existsSync(migrationsDir)
  ? fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
  : [];

const sql = files.map((name) => fs.readFileSync(path.join(migrationsDir, name), 'utf8')).join('\n').toLowerCase();
const functions = [
  'enqueue_web_studio_followups',
  'approve_web_studio_followups',
  'claim_web_studio_followups',
  'finish_web_studio_followup',
  'requeue_web_studio_followups',
];

for (const fn of functions) {
  const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const revoke = new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${escaped}\\s*\\([^;]*?\\)\\s+from\\s+(?:public\\s*,\\s*)?anon\\s*,\\s*authenticated`, 'i');
  const grant = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${escaped}\\s*\\([^;]*?\\)\\s+to\\s+service_role`, 'i');
  if (!revoke.test(sql)) throw new Error(`Missing anon/authenticated EXECUTE revoke for ${fn}`);
  if (!grant.test(sql)) throw new Error(`Missing service_role EXECUTE grant for ${fn}`);
}

console.log('FOLLOWUP_RPC_SECURITY_OK');
