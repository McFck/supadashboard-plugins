import { isCode } from './protocol.js';

const form = document.querySelector('form');
const code = document.querySelector('#code');
const button = document.querySelector('button');
const status = document.querySelector('[role="status"]');
const slots = [...document.querySelectorAll('.slots i')];
const labels = {
  paired: 'Paired',
  offline: 'Dashboard offline',
  code: 'Wrong code',
  expired: 'Code expired',
  auth: 'Pair the browser again',
  update: 'Update extension',
  dashboard_update: 'Update SupaDashboard',
  storage: 'Could not save pairing',
};
let busy = false;

/** Mirrors the input into the slots; the focused slot is the next one to fill, or the last when full. */
function render() {
  const focused = document.activeElement === code;
  const next = Math.min(code.value.length, slots.length - 1);
  slots.forEach((slot, index) => {
    slot.textContent = code.value[index] ?? '';
    slot.classList.toggle('active', focused && index === next);
  });
}

function show(state) {
  status.textContent = labels[state] ?? labels.offline;
  status.dataset.state = state;
  form.hidden = state === 'paired';
}

function changed() {
  code.value = code.value.replace(/[^0-9]/g, '').slice(0, 6);
  render();
  button.disabled = busy || !isCode(code.value);
  if (!button.disabled) {
    form.requestSubmit();
  }
}

code.addEventListener('input', changed);
code.addEventListener('focus', render);
code.addEventListener('blur', render);
code.addEventListener('paste', (event) => {
  event.preventDefault();
  code.value = event.clipboardData?.getData('text') ?? '';
  changed();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy || !isCode(code.value)) {
    return;
  }
  busy = true;
  button.disabled = true;
  status.textContent = 'Pairing';
  try {
    const result = await chrome.runtime.sendMessage({ code: code.value });
    show(result.status);
    if (!form.hidden) {
      code.select();
    }
  } catch {
    show('offline');
  } finally {
    busy = false;
    button.disabled = !isCode(code.value);
  }
});

chrome.runtime.sendMessage({ status: true }).then(
  (result) => {
    if (!busy) {
      show(result.status);
    }
  },
  () => show('offline'),
);
