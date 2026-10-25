const RULES = [
  {
    id: 'embedded-secret', severity: 'high', title: 'Possible embedded credential',
    pattern: /(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|client[_-]?secret)\s*[:=]\s*["'`][^"'`\n]{8,}["'`]/i,
    recommendation: 'Review this assignment. Keep real credentials outside source control and load them through the application’s supported secret configuration.',
  },
  {
    id: 'private-key', severity: 'high', title: 'Private key material',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/,
    recommendation: 'Remove private key material from source and rotate the key if it has been exposed. This tool does not upload the pasted content.',
  },
  {
    id: 'dynamic-evaluation', severity: 'high', title: 'Dynamic code evaluation',
    pattern: /\b(?:eval|exec)\s*\(|\bnew\s+Function\s*\(/,
    recommendation: 'Check whether untrusted input can reach this call. Prefer a constrained parser or explicit operations over evaluating arbitrary source.',
  },
  {
    id: 'shell-command', severity: 'high', title: 'Shell execution needs review',
    pattern: /\b(?:shell\s*=\s*True|os\.system\s*\(|child_process\.exec\s*\(|execSync\s*\(|(?:exec|execSync)\s*\(\s*`[^`]*\$\{)/,
    recommendation: 'Check input provenance. Use an executable and separate argument array with shell execution disabled where possible.',
  },
  {
    id: 'html-insertion', severity: 'medium', title: 'HTML insertion sink',
    pattern: /\.innerHTML\s*=|dangerouslySetInnerHTML\s*=|document\.write\s*\(/,
    recommendation: 'Confirm content is trusted or sanitized with an appropriate maintained sanitizer. Use text rendering when markup is unnecessary.',
  },
  {
    id: 'sql-interpolation', severity: 'high', title: 'Possible SQL interpolation',
    pattern: /(?:SELECT\b|INSERT\s+INTO\b|UPDATE\b|DELETE\s+FROM\b).*(?:\$\{|\{[\w.[\]]+\}|["'`]\s*\+|%s)/i,
    recommendation: 'Check this query and its call site. Use the database driver’s parameter binding. A %s placeholder can be safe when parameters are passed separately.',
  },
  {
    id: 'tls-disabled', severity: 'high', title: 'TLS verification may be disabled',
    pattern: /\bverify\s*=\s*False|\brejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|\bcurl\s+(?:[^\n]*\s)?(?:-k\b|--insecure\b)/,
    recommendation: 'Keep certificate verification enabled. Fix the certificate chain or use supported trust configuration instead of bypassing verification.',
  },
  {
    id: 'unsafe-deserialization', severity: 'high', title: 'Deserialization needs trusted input',
    pattern: /\bpickle\.loads?\s*\(|\byaml\.load\s*\(/,
    recommendation: 'Never deserialize untrusted executable object formats. Prefer a data-only format; use safe YAML loading where supported.',
  },
  {
    id: 'weak-hash', severity: 'medium', title: 'Legacy digest algorithm',
    pattern: /\b(?:md5|sha1)\s*\(|createHash\s*\(\s*["'](?:md5|sha1)["']/i,
    recommendation: 'Check the purpose. Prefer SHA-256 for file integrity and a dedicated password hashing algorithm for passwords.',
  },
];

export function reviewSource(source) {
  if (typeof source !== 'string') throw new TypeError('Source must be text.');
  if (source.length > 200_000) throw new Error('Limit the review to 200,000 characters.');
  const lines = source.split(/\r?\n/);
  const findings = [];
  lines.forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({id: `${rule.id}-${index + 1}`, rule: rule.id, line: index + 1,
          severity: rule.severity, title: rule.title, recommendation: rule.recommendation});
      }
    }
  });
  return {lines: lines.length, findings, high: findings.filter(f => f.severity === 'high').length,
    medium: findings.filter(f => f.severity === 'medium').length};
}

export function compareDigest(actual, expected) {
  const normalized = expected.trim().toLowerCase();
  if (!normalized) return 'empty';
  if (!/^[a-f0-9]{64}$/.test(normalized)) return 'invalid';
  return actual.toLowerCase() === normalized ? 'match' : 'mismatch';
}
