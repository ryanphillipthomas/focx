const element = id => document.getElementById(id);
let planned = null;
let working = false;
async function request(path, body) {
  const response = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Operation unavailable.');
  return data;
}
function stage(value, message) {
  for (const name of ['idle', 'planned', 'applying', 'verified']) {
    element(`stage-${name}`).removeAttribute('aria-current');
  }
  element(`stage-${value}`).setAttribute('aria-current', 'step');
  element('message').textContent = message;
}
function controls() {
  element('plan').disabled = working;
  element('company-name').disabled = working;
  element('confirm').disabled = working;
  element('apply').disabled = working || !planned || !element('confirm').checked;
}
function discard() {
  planned = null;
  element('preview').hidden = true;
  element('result').hidden = true;
  element('confirm').checked = false;
  controls();
}
element('company-name').addEventListener('input', () => {
  discard(); stage('idle', 'Name changed. Plan again before applying.');
});
element('confirm').addEventListener('change', controls);
element('plan-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (working) return;
  discard(); working = true; controls();
  stage('idle', 'Planning fake operation…');
  const name = element('company-name').value;
  try {
    const data = await request('/api/plan', { name });
    planned = { name, digest: data.digest };
    element('operations').replaceChildren(...data.preview.changes.map(operation => {
      const row = document.createElement('tr');
      for (const key of ['method', 'path']) {
        const cell = document.createElement('td');
        cell.textContent = operation[key]; row.append(cell);
      }
      return row;
    }));
    element('digest').textContent = data.digest;
    element('coverage').textContent = data.digestCoversUnlistedOperations ? data.reason : '';
    element('preflight').textContent = JSON.stringify(data.preflight, null, 2);
    element('preview').hidden = false;
    stage('planned', 'Review the operations and digest, then confirm to apply.');
  } catch (error) { stage('idle', error.message); }
  finally { working = false; controls(); }
});
element('apply').addEventListener('click', async () => {
  if (working || !planned || !element('confirm').checked) return;
  working = true; controls(); stage('applying', 'Applying the confirmed fake plan…');
  const body = planned; planned = null;
  try {
    const { result } = await request('/api/apply', body);
    element('result-data').textContent = JSON.stringify(result, null, 2);
    element('verification').textContent = result.complete
      ? 'focx-bot completed its import and readback checks.'
      : 'focx-bot passed its import and readback checks. Provisioning is incomplete; see the returned phase and secret requirements below. Fake state lasts only for this subprocess.';
    element('result').hidden = false;
    stage('verified', 'Verified · fake import checks passed.');
  } catch (error) {
    element('preview').hidden = true;
    stage('idle', `${error.message} No automatic retry was made.`);
  } finally { working = false; controls(); }
});
element('teach').addEventListener('click', () => {
  element('skill').hidden = false; element('close-skill').focus();
});
element('close-skill').addEventListener('click', () => {
  element('skill').hidden = true; element('teach').focus();
});
try {
  const identity = await request('/api/developer');
  if (identity.unavailable) element('identity-message').textContent = identity.reason;
  else {
    element('bot-name').textContent = identity.name;
    element('bot-status').textContent = identity.status;
    for (const [id, key] of [['model', 'model'], ['adapter', 'adapterType'], ['company', 'companyName'], ['prefix', 'issuePrefix']]) {
      element(id).textContent = identity[key];
    }
    element('identity-message').textContent = 'Read-only identity from the local API.';
    element('identity').hidden = false;
  }
} catch { element('identity-message').textContent = 'Developer identity unavailable. The local console server could not be reached.'; }
