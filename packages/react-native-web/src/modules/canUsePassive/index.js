export default function canUsePassive() {
  let supportsPassive = false;
  try {
    const opts = Object.defineProperty({}, 'passive', {
      // eslint-disable-next-line getter-return
      get() {
        supportsPassive = true;
      }
    });
    window.addEventListener('testPassive', null, opts);
    window.removeEventListener('testPassive', null, opts);
    // eslint-disable-next-line no-empty
  } catch (e) {}
  return supportsPassive;
}
