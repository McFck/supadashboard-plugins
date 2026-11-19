import { fields, isCode } from './protocol.js';

const form = document.querySelector('form');
const code = document.querySelector('#code');
const button = document.querySelector('button');
const unpair = document.querySelector('#unpair');
const status = document.querySelector('[role="status"]');
const slots = [...document.querySelectorAll('.slots i')];
const labels = {
  paired: 'Paired',
  unpaired: 'Unpaired',
  offline: 'Dashboard offline',
  code: 'Wrong code',
  expired: 'Code expired',
  auth: 'Pair the browser again',
  update: 'Update extension',
  dashboard_update: 'Update SupaDashboard',
  storage: 'Could not update pairing',
};
let busy = false;

function render() {
  const focused = document.activeElement === code;
  const next = Math.min(code.value.length, slots.length - 1);
  slots.forEach((slot, index) => {
    slot.textContent = code.value[index] ?? '';
    slot.classList.toggle('active', focused && index === next);
  });
}

function show({ status: state, saved = false, pending = false }) {
  status.textContent = labels[state] ?? labels.offline;
  if (pending) {
    status.textContent = 'Unpairing';
  }
  status.dataset.state = state;
  form.hidden = state === 'paired' || pending;
  unpair.hidden = !saved;
  unpair.disabled = busy || pending;
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
    show(result);
    if (!form.hidden) {
      code.select();
    }
  } catch {
    show({ status: 'offline' });
  } finally {
    busy = false;
    button.disabled = !isCode(code.value);
    unpair.disabled = false;
  }
});

unpair.addEventListener('click', async () => {
  unpair.disabled = true;
  try {
    show(await chrome.runtime.sendMessage({ kind: 'unpair' }));
  } catch {
    show({ status: 'storage', saved: true });
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (
    sender.id === chrome.runtime.id &&
    !sender.tab &&
    fields(message, 'status', 'saved', 'pending') &&
    typeof message.status === 'string' &&
    typeof message.saved === 'boolean' &&
    typeof message.pending === 'boolean' &&
    !busy
  ) {
    show(message);
  }
});

chrome.runtime.sendMessage({ status: true }).then(
  (result) => {
    if (!busy) {
      show(result);
    }
  },
  () => show({ status: 'offline' }),
);
