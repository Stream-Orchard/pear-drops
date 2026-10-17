// Turns on Electron's cookie-encryption fuse (and switches off the ways to run the
// engine as plain Node), the same protection Stream Multiview uses for saved logins.
// With it on, the Kick login cookie is encrypted with a key kept in the macOS
// Keychain / Windows DPAPI, so a copied data folder is useless elsewhere.
// `npm start` runs this first; it only changes the engine the first time.
//   node scripts/harden.js           turn it on if needed
//   node scripts/harden.js --check   only report
const { flipFuses, getCurrentFuseWire, FuseVersion, FuseV1Options, FuseState } = require('@electron/fuses');

// Dev copies keep the inspector so tests and tools (Playwright) can drive them;
// installed builds switch it off too.
const wanted = ({ packaged = false } = {}) => ({
  [FuseV1Options.EnableCookieEncryption]: true,
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: !packaged,
});

async function state(exe, options) {
  const wire = await getCurrentFuseWire(exe);
  return Object.entries(wanted(options)).every(([fuse, on]) => {
    const value = wire[fuse];
    return value === FuseState.REMOVED || value === (on ? FuseState.ENABLE : FuseState.DISABLE);
  });
}

async function harden(exe, { resetSignature = true, packaged = false } = {}) {
  if (await state(exe, { packaged })) return 'on';
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: resetSignature && process.platform === 'darwin',
    ...wanted({ packaged }),
  });
  return (await state(exe, { packaged })) ? 'turned-on' : 'failed';
}

module.exports = { harden, state };

if (require.main === module) {
  (async () => {
    let exe;
    try {
      exe = require('electron');
    } catch {
      console.log('Login encryption: Electron is not installed yet.');
      return;
    }
    try {
      if (process.argv.includes('--check')) {
        console.log(`Login encryption: ${(await state(exe)) ? 'on' : 'off'}`);
      } else {
        console.log(`Login encryption: ${await harden(exe)}`);
      }
    } catch (err) {
      // e.g. the app is running and the engine file is locked: try again next start
      console.log(`Login encryption: will be turned on next start (${err.code || err.message})`);
    }
  })();
}
