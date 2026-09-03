import { Button } from '@focx/design-connect';

const primaryButtonSheet = document.querySelector('[data-primary-button-examples]');
const examples = [
  { state: 'default' },
  { state: 'hover' },
  { state: 'focused' },
  { state: 'disabled' },
];

primaryButtonSheet.replaceChildren(
  ...examples.map(({ state }) => Button({ state })),
);
