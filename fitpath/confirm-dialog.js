(() => {
  const dialog = document.querySelector('#confirm-dialog');
  if (!dialog) return;
  const form = dialog.querySelector('#confirm-form');
  const title = dialog.querySelector('#confirm-title');
  const message = dialog.querySelector('#confirm-message');
  const passwordWrap = dialog.querySelector('#confirm-password-wrap');
  const password = dialog.querySelector('#confirm-password');
  const error = dialog.querySelector('#confirm-error');
  const submit = dialog.querySelector('#confirm-submit');
  let resolveResult = null;
  const finish = result => { const resolve = resolveResult; resolveResult = null; dialog.close(); if (resolve) resolve(result); };
  dialog.querySelectorAll('[data-confirm-cancel]').forEach(button => button.addEventListener('click', () => finish({ confirmed: false })));
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish({ confirmed: false }); });
  dialog.addEventListener('click', event => { if (event.target === dialog) finish({ confirmed: false }); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!passwordWrap.classList.contains('hidden') && !password.value) { error.textContent = 'Enter your password to continue.'; password.focus(); return; }
    finish({ confirmed: true, password: password.value });
  });
  window.fitpathConfirm = options => new Promise(resolve => {
    resolveResult = resolve; title.textContent = options.title || 'Are you sure?'; message.textContent = options.message || '';
    submit.textContent = options.confirmText || 'Continue'; submit.classList.toggle('confirm-danger', Boolean(options.danger));
    password.value = ''; password.required = false; passwordWrap.classList.toggle('hidden', !options.requirePassword); error.textContent = '';
    dialog.showModal(); (options.requirePassword ? password : dialog.querySelector('[data-confirm-cancel]')).focus();
  });
})();
