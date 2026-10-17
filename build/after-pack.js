// electron-builder hook: switch on login encryption in the packaged app before it is signed.
const path = require('path');
const { harden } = require('../scripts/harden');

exports.default = async function afterPack(context) {
  const name = context.packager.appInfo.productFilename;
  const exe =
    context.electronPlatformName === 'darwin'
      ? path.join(context.appOutDir, `${name}.app`, 'Contents', 'MacOS', name)
      : path.join(context.appOutDir, `${name}.exe`);
  const res = await harden(exe, { resetSignature: false, packaged: true }); // electron-builder signs afterwards
  if (res !== 'on' && res !== 'turned-on') throw new Error(`after-pack: could not switch on login encryption (${res})`);
};
