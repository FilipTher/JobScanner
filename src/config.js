import fs from 'node:fs';
import path from 'node:path';

export const root = path.join(import.meta.dirname, '..');
export const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
