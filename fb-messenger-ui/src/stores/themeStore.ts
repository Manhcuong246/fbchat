import { createSignal } from 'solid-js';

const [isDark, setIsDark] = createSignal(false);

const toggleTheme = () => {
  const next = !isDark();
  setIsDark(next);
  document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
  localStorage.setItem('theme', next ? 'dark' : 'light');
};

// Load saved theme on init
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
  setIsDark(true);
  document.documentElement.setAttribute('data-theme', 'dark');
}

export { isDark, toggleTheme };
