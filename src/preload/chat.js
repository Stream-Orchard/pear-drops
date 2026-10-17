// Preload for the docked popout chat (light panel mode). Chat doesn't affect drops;
// this only keeps Kick's cookie banner and upsell prompts from covering it.
const DECLINE = /^(not now|maybe later|no thanks|dismiss)$/i;

function tidy() {
  const reject = document.querySelector('#onetrust-reject-all-handler');
  if (reject && reject.offsetParent !== null) reject.click();
  for (const b of document.querySelectorAll('button')) {
    if (DECLINE.test(b.textContent.trim()) && b.offsetParent !== null) b.click();
  }
}

const timer = setInterval(tidy, 1500);
setTimeout(() => clearInterval(timer), 60_000);
