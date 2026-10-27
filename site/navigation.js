const menuButton = document.querySelector('.nav-toggle');
const menuLinks = document.querySelector('.nav-links');
const mobileLayout = window.matchMedia('(max-width: 780px)');

function setMenuOpen(open) {
  menuButton.setAttribute('aria-expanded', String(open));
  menuLinks.classList.toggle('is-open', open);
}

menuButton.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') !== 'true';
  setMenuOpen(open);
  if (open) menuLinks.querySelector('a').focus();
});

menuLinks.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || !mobileLayout.matches) return;
  setMenuOpen(false);
  const target = document.getElementById(link.hash.slice(1));
  if (target) {
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
    event.preventDefault();
    setMenuOpen(false);
    menuButton.focus();
  }
});

function dismissOutside(event) {
  if (
    menuButton.getAttribute('aria-expanded') === 'true' &&
    !menuButton.contains(event.target) &&
    !menuLinks.contains(event.target)
  ) {
    const menuHadFocus = menuLinks.contains(document.activeElement);
    setMenuOpen(false);
    if (menuHadFocus) menuButton.focus({ preventScroll: true });
  }
}

document.addEventListener('pointerdown', dismissOutside);
document.addEventListener('focusin', dismissOutside);

mobileLayout.addEventListener('change', () => {
  const focusedElement = document.activeElement;
  setMenuOpen(false);
  if (mobileLayout.matches && menuLinks.contains(focusedElement)) menuButton.focus();
  if (!mobileLayout.matches && focusedElement === menuButton) menuLinks.querySelector('a').focus();
});
