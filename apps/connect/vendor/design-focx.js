// Browser distribution of @focx/design-focx/src/button.js for the copy-only static app.
const BUTTON_STYLES_ID = 'focx-button-styles';

function installButtonStyles(document) {
  if (document.getElementById(BUTTON_STYLES_ID)) return;

  const styles = document.createElement('style');
  styles.id = BUTTON_STYLES_ID;
  styles.textContent = `
    .focx-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-3);
      height: var(--control-h-md);
      padding: 0 var(--control-px-md);
      border: none;
      border-radius: var(--radius-pill);
      cursor: pointer;
      font-family: var(--font-sans), system-ui, sans-serif;
      font-size: var(--text-label);
      font-weight: var(--weight-medium);
      color: var(--action-fill-text);
      background: var(--action-fill);
    }

    .focx-button:hover,
    .focx-button[data-state="hover"] {
      background: var(--action-fill-hover);
    }

    .focx-button:focus-visible,
    .focx-button[data-state="focused"] {
      outline: var(--border-focus-ring) solid var(--border-focus);
      outline-offset: var(--border-focus-ring);
    }

    .focx-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .focx-button:disabled:hover {
      background: var(--action-fill);
    }
  `;
  document.head.append(styles);
}

export function Button({
  label = 'Button',
  state = 'default',
  disabled = state === 'disabled',
  title,
  document: ownerDocument = globalThis.document,
} = {}) {
  if (!ownerDocument) throw new Error('Button requires a DOM document');
  installButtonStyles(ownerDocument);

  const button = ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'focx-button';
  button.textContent = label;
  button.disabled = disabled;
  button.title = title ?? `Medium / Pill / ${state[0].toUpperCase()}${state.slice(1)}`;
  if (state === 'hover' || state === 'focused') button.dataset.state = state;
  return button;
}

export const DESIGN_SYSTEM = 'focx';
