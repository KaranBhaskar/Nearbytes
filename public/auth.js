const els = {
  loginForm: document.getElementById('login-form'),
  signupForm: document.getElementById('signup-form'),
  backLink: document.getElementById('back-link'),
  returnTarget: document.getElementById('return-target'),
  themeToggleBtn: document.getElementById('theme-toggle'),
  toast: document.getElementById('toast'),
};

const SAVED_LOGIN_EMAIL_KEY = 'savedLoginEmail';
const SAVED_LOGIN_PASSWORD_KEY = 'savedLoginPassword';
const SAVED_SIGNUP_NAME_KEY = 'savedSignupName';
const SAVED_SIGNUP_EMAIL_KEY = 'savedSignupEmail';
const SAVED_SIGNUP_PASSWORD_KEY = 'savedSignupPassword';

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  const styles = getComputedStyle(document.body);
  els.toast.style.background = isError
    ? styles.getPropertyValue('--toast-error').trim()
    : styles.getPropertyValue('--toast-success').trim();
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 2600);
}

function getReturnTo() {
  const params = new URLSearchParams(window.location.search);
  const rawReturnTo = params.get('returnTo') || '/';

  try {
    const parsed = new URL(rawReturnTo, window.location.origin);
    if (parsed.origin !== window.location.origin) {
      return '/';
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
  } catch (_err) {
    return '/';
  }
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');

  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data = null;
  try {
    data = await response.json();
  } catch (_err) {
    data = null;
  }

  if (!response.ok) {
    const message = data && data.error ? data.error : 'Request failed';
    throw new Error(message);
  }

  return data;
}

function saveAuth(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function saveLoginCredentials(email, password) {
  localStorage.setItem(SAVED_LOGIN_EMAIL_KEY, email);
  localStorage.setItem(SAVED_LOGIN_PASSWORD_KEY, password);
}

function saveSignupCredentials(name, email, password) {
  localStorage.setItem(SAVED_SIGNUP_NAME_KEY, name);
  localStorage.setItem(SAVED_SIGNUP_EMAIL_KEY, email);
  localStorage.setItem(SAVED_SIGNUP_PASSWORD_KEY, password);
}

function prefillSavedCredentials() {
  const loginEmailInput = els.loginForm.querySelector('input[name="email"]');
  const loginPasswordInput = els.loginForm.querySelector('input[name="password"]');
  const signupNameInput = els.signupForm.querySelector('input[name="name"]');
  const signupEmailInput = els.signupForm.querySelector('input[name="email"]');
  const signupPasswordInput = els.signupForm.querySelector('input[name="password"]');

  if (loginEmailInput) loginEmailInput.value = localStorage.getItem(SAVED_LOGIN_EMAIL_KEY) || '';
  if (loginPasswordInput) loginPasswordInput.value = localStorage.getItem(SAVED_LOGIN_PASSWORD_KEY) || '';
  if (signupNameInput) signupNameInput.value = localStorage.getItem(SAVED_SIGNUP_NAME_KEY) || '';
  if (signupEmailInput) signupEmailInput.value = localStorage.getItem(SAVED_SIGNUP_EMAIL_KEY) || '';
  if (signupPasswordInput) signupPasswordInput.value = localStorage.getItem(SAVED_SIGNUP_PASSWORD_KEY) || '';
}

function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.body.classList.toggle('dark', isDark);

  if (els.themeToggleBtn) {
    els.themeToggleBtn.textContent = isDark ? '☀️ Light Mode' : '🌙 Dark Mode';
  }

  localStorage.setItem('theme', theme);
}

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    applyTheme(savedTheme);
    return;
  }

  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(prefersDark ? 'dark' : 'light');
}

function bindEvents(returnTo) {
  els.themeToggleBtn.addEventListener('click', () => {
    const isDark = document.body.classList.contains('dark');
    applyTheme(isDark ? 'light' : 'dark');
  });

  els.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(els.loginForm);
    const loginMode = String(formData.get('loginMode') || 'standard');
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');

    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: {
          email,
          password,
          loginMode,
        },
      });

      saveAuth(data.token, data.user);
      saveLoginCredentials(email, password);
      showToast('Logged in, redirecting...');
      window.setTimeout(() => {
        window.location.assign(returnTo);
      }, 250);
    } catch (err) {
      showToast(err.message, true);
    }
  });

  els.signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(els.signupForm);
    const name = String(formData.get('name') || '').trim();
    const email = String(formData.get('email') || '').trim();
    const password = String(formData.get('password') || '');

    try {
      const data = await api('/api/auth/signup', {
        method: 'POST',
        body: {
          name,
          email,
          password,
          role: String(formData.get('role') || 'customer'),
        },
      });

      saveAuth(data.token, data.user);
      saveSignupCredentials(name, email, password);
      saveLoginCredentials(email, password);
      showToast('Account created, redirecting...');
      window.setTimeout(() => {
        window.location.assign(returnTo);
      }, 250);
    } catch (err) {
      showToast(err.message, true);
    }
  });
}

function init() {
  const returnTo = getReturnTo();
  els.backLink.href = returnTo;
  els.returnTarget.textContent = `After sign in, you will return to: ${returnTo}`;
  prefillSavedCredentials();
  initTheme();
  bindEvents(returnTo);
}

init();
