// electron-builder hook (macOS): when MAC_SIGN_IDENTITY is set, re-sign the app with
// that (self-signed or real) certificate. A stable signature keeps the Keychain
// entry that encrypts the saved Kick login readable after updates; an ad-hoc
// signature changes every build and would make the app forget the login.
const { execFileSync } = require('child_process');
const path = require('path');

/**
 * The best signing identity on this Mac. An Apple-issued certificate has a Team ID,
 * which is what lets the Keychain recognise every future version without asking:
 * Developer ID Application (paid, also passes Gatekeeper), then Apple Development
 * (free with an Apple ID in Xcode), then the self-signed local one, then ad hoc.
 */
function localIdentity() {
  let list = '';
  try {
    list = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  } catch {}
  for (const kind of ['Developer ID Application', 'Apple Development']) {
    const m = list.match(new RegExp(`"(${kind}: [^"]+)"`));
    if (m) return m[1];
  }
  return require('../scripts/mac-signing-cert').identity() ?? '-';
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!process.env.MAC_SIGN_IDENTITY) {
    // Local builds: the "Pear Drops Local Signing" identity (scripts/mac-signing-cert.js)
    // if it exists, so every build has the same identity; otherwise ad hoc, so Apple
    // Silicon still runs it after the fuses changed the engine.
    const identity = localIdentity();
    console.log(`  • signing with ${identity === '-' ? 'an ad-hoc signature' : `"${identity}"`}`);
    if (!/^(Developer ID Application|Apple Development)/.test(identity)) {
      console.log('    note: without an Apple-issued certificate (it carries a Team ID), macOS asks for Keychain access again after each update');
    }
    execFileSync('codesign', ['--force', '--deep', '--sign', identity, app], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
    return;
  }
  const keychain = process.env.MAC_SIGN_KEYCHAIN ? ['--keychain', process.env.MAC_SIGN_KEYCHAIN] : [];
  execFileSync('codesign', ['--force', '--deep', '--sign', process.env.MAC_SIGN_IDENTITY, ...keychain, app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  const req = execFileSync('codesign', ['-d', '-r-', app], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!/certificate/.test(req)) throw new Error('after-sign: the designated requirement is not tied to a certificate');
};
