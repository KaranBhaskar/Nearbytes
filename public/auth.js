const els = {
  loginForm: document.getElementById('login-form'),
  signupForm: document.getElementById('signup-form'),
  backLink: document.getElementById('back-link'),
  returnTarget: document.getElementById('return-target'),
  themeToggleBtn: document.getElementById('theme-toggle'),
  toast: document.getElementById('toast'),
};

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  els.toast.style.background = isError ? '#8e2410' : '#1a1f1d';
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

    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: {
          email: String(formData.get('email') || '').trim(),
          password: String(formData.get('password') || ''),
        },
      });

      saveAuth(data.token, data.user);
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

    try {
      const data = await api('/api/auth/signup', {
        method: 'POST',
        body: {
          name: String(formData.get('name') || '').trim(),
          email: String(formData.get('email') || '').trim(),
          password: String(formData.get('password') || ''),
          role: String(formData.get('role') || 'customer'),
        },
      });

      saveAuth(data.token, data.user);
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
  initTheme();
  bindEvents(returnTo);
}

init();
