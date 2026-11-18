const form = document.querySelector('form');
const code = document.querySelector('#code');
const button = document.querySelector('button');
const status = document.querySelector('[role="status"]');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  status.textContent = '';
  try {
    const { paired } = await chrome.runtime.sendMessage({ code: code.value.trim().toLowerCase() });
    if (!paired) {
      throw new Error('Pairing rejected');
    }
    code.value = '';
    status.textContent = 'Paired';
  } catch {
    status.textContent = 'Could not pair';
  } finally {
    button.disabled = false;
  }
});
