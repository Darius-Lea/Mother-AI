// Workflow summaries and raw logs can require sign-in. A bounded, sanitized
// annotation makes the actual failed phase visible on the public job page.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function diagnosticAnnotation(filename, text, secrets = []) {
  if (!/^desktop-(?:tests|runtime|build)\.log$/.test(filename)) throw new Error('Unknown installer diagnostic log.');
  let excerpt = String(text).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/).filter(line => line.trim()).slice(-20).join('\n').slice(-9000);
  for (const secret of secrets.filter(value => typeof value === 'string' && value.length >= 8).sort((one,two) => two.length-one.length)) excerpt = excerpt.split(secret).join('[redacted]');
  excerpt = excerpt.replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]')
    .replace(/(https?:\/\/[^\s?"']+)\?[^\s"']+/g, '$1?[redacted]')
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [redacted]')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  const escaped = excerpt.replaceAll('%','%25').replaceAll('\r','%0D').replaceAll('\n','%0A');
  return `::error title=Installer failure (${filename})::${escaped || 'The phase failed without additional diagnostic output.'}`;
}

export async function annotateInstallerFailure(directory = '.', environment = process.env) {
  const secrets = Object.entries(environment).filter(([name]) => /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|AUTH_KEY)$/i.test(name)).map(([,value]) => value);
  for (const filename of ['desktop-build.log','desktop-runtime.log','desktop-tests.log']) {
    let text;
    try { text = await readFile(path.join(directory,filename),'utf8'); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    console.log(diagnosticAnnotation(filename,text,secrets));
    return filename;
  }
  console.log('::error title=Installer failure::The job failed before diagnostic output was recorded.');
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await annotateInstallerFailure();
