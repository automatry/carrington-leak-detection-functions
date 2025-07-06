import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const outputFile = path.join(__dirname, 'project-export.txt');
const ignoredDirs = ['node_modules', '.git', 'dist', 'build', 'out', 'lib', '.next','.firebase'];
const ignoredFiles = ['package-lock.json', 'firebase-debug.log', 'firebase-debug.log.1', 'database-debug.log', 'database-debug.log.1', 'firebase-debug.log', 'firestore-debug.log'];

// Files to always include even if they don't have typical extensions
const explicitlyIncludedFiles = [
  '.env',
  '.env.sample',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'package.json',
];

const allowedExtensions = [
  '.js', '.ts', '.json', '.md', '.html',
  '.css', '.txt', '.env', '.yml', '.yaml',
  '.rules', '.sample', '.config', '.conf',
  '.sh', '.bash', '.txt', '.log', '.xml',
  'tsx', '.jsx', '.cjs', '.mjs', '.wasm',
  '.firebaserc',
];

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath);
  return (
    allowedExtensions.includes(ext) ||
    explicitlyIncludedFiles.includes(base)
  );
}

async function walkDir(dir, files = []) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirs.includes(entry.name)) {
        await walkDir(fullPath, files);
      }
    } else if (
      entry.isFile() &&
      isTextFile(fullPath) &&
      !ignoredFiles.includes(entry.name)
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

async function exportProject() {
  try {
    const allFiles = await walkDir(__dirname);
    const writeStream = fs.createWriteStream(outputFile, { flags: 'w' });

    for (const file of allFiles) {
      const content = await fs.promises.readFile(file, 'utf-8');
      writeStream.write(`\n\n===== FILE: ${path.relative(__dirname, file)} =====\n\n`);
      writeStream.write(content);
    }

    writeStream.end();
    console.log(`✅ Project exported to: ${outputFile}`);
  } catch (err) {
    console.error('❌ Error exporting project:', err);
  }
}

exportProject();
