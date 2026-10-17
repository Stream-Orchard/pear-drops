// macOS: creates a self-signed "Pear Drops Local Signing" code-signing identity in
// the login keychain (once). Builds signed with it keep the same identity from
// version to version, so the Keychain's "Always Allow" for the saved Kick login
// carries over and updates don't ask for your password again.
//   node scripts/mac-signing-cert.js          create it if it's missing
//   node scripts/mac-signing-cert.js --check  only report
// Remove it any time in Keychain Access (search "Pear Drops Local Signing").
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME = 'Pear Drops Local Signing';

/** The local signing identity's name if it's in the keychain, or null. */
function identity() {
  try {
    execFileSync('security', ['find-certificate', '-c', NAME], { stdio: 'ignore' });
    return NAME;
  } catch {
    return null;
  }
}

function exists() {
  return !!identity();
}

function create() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-cert-'));
  try {
    const cfg = path.join(dir, 'cert.cnf');
    fs.writeFileSync(
      cfg,
      [
        '[req]',
        'distinguished_name = dn',
        'prompt = no',
        '[dn]',
        `CN = ${NAME}`,
        '[codesign]',
        'basicConstraints = critical, CA:false',
        'keyUsage = critical, digitalSignature',
        'extendedKeyUsage = critical, codeSigning',
        'subjectKeyIdentifier = hash',
      ].join('\n'),
    );
    const key = path.join(dir, 'key.pem');
    const cert = path.join(dir, 'cert.pem');
    const p12 = path.join(dir, 'identity.p12');
    const pass = Math.random().toString(36).slice(2);
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-keyout', key, '-out', cert, '-config', cfg, '-extensions', 'codesign'], { stdio: 'ignore' });
    // -legacy: the Keychain only reads the older PKCS#12 encryption.
    const legacy = /OpenSSL [3-9]/.test(execFileSync('openssl', ['version'], { encoding: 'utf8' })) ? ['-legacy'] : [];
    execFileSync('openssl', ['pkcs12', '-export', ...legacy, '-inkey', key, '-in', cert, '-name', NAME, '-out', p12, '-passout', `pass:${pass}`], { stdio: 'ignore' });
    const keychain = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db');
    execFileSync('security', ['import', p12, '-k', keychain, '-P', pass, '-T', '/usr/bin/codesign'], { stdio: 'inherit' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { NAME, exists, identity };

if (require.main === module) {
  if (process.platform !== 'darwin') {
    console.log('Only needed on macOS.');
    process.exit(0);
  }
  if (exists()) console.log(`Signing identity: "${identity()}" is ready`);
  else if (process.argv.includes('--check')) console.log(`Signing identity: missing (run node scripts/mac-signing-cert.js)`);
  else {
    create();
    console.log(exists() ? `Signing identity: created "${NAME}" in your login keychain` : 'Signing identity: could not be created');
  }
}
