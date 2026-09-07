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
    element('coverage').textContent = data.digestCoversUnlistedOperations
      ? `${data.reason} This screen shows the emitted preview; it does not combine the lists.` : '';
    element('coverage').hidden = !data.digestCoversUnlistedOperations;
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
// One card per declared pilot role. Text nodes only — never innerHTML, since
// these values come from the control plane.
function card(agent) {
  const box = document.createElement('section');
  box.className = 'agent';
  const name = document.createElement('h3');
  name.textContent = agent.name;
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = agent.unresolved ? 'Unresolved' : agent.status;
  name.append(' ', chip);
  box.append(name);
  if (agent.unresolved) {
    const why = document.createElement('p');
    why.textContent = agent.reason;
    box.append(why);
    return box;
  }
  const list = document.createElement('dl');
  for (const [label, key] of [['Role', 'roleKey'], ['Model', 'model'], ['Adapter', 'adapterType'],
    ['Company', 'companyName'], ['Issue prefix', 'issuePrefix']]) {
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = agent[key];
    list.append(dt, dd);
  }
  box.append(list);

  // Procedures: the method files this agent reads. Small and worth naming.
  box.append(labelled('Procedures', agent.procedures?.length
    ? agent.procedures.join(', ')
    : 'None declared'));

  // Plugins: where the pinned library actually reaches an agent. Counts by
  // default — nobody reads 73 names — with the names available on demand.
  if (!agent.provisioned) {
    box.append(labelled('Plugins', 'Not in the provisioning contract'));
  } else {
    const claude = agent.claudePlugins ?? [];
    const codex = agent.codexPlugins ?? [];
    box.append(labelled('Plugins', `${claude.length} Claude · ${codex.length} Codex`));
    const all = [...claude, ...codex];
    if (all.length) {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      summary.textContent = `Show ${all.length}`;
      const names = document.createElement('ul');
      for (const key of all) {
        const li = document.createElement('li');
        li.textContent = key;
        names.append(li);
      }
      details.append(summary, names);
      box.append(details);
    }
  }
  return box;
}
function labelled(label, value) {
  const p = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `${label}: `;
  p.append(strong, document.createTextNode(value));
  return p;
}
try {
  const identity = await request('/api/agents');
  if (identity.unavailable) element('identity-message').textContent = identity.reason;
  else {
    const list = identity.agents ?? [];
    const container = element('agents');
    for (const agent of list) container.append(card(agent));
    const resolved = list.filter(a => !a.unresolved).length;
    element('agent-count').textContent = `${resolved} of ${list.length} resolved`;
    element('identity-message').textContent = 'Read-only identities from the local API.';
    container.hidden = false;
  }
} catch { element('identity-message').textContent = 'Agent identities unavailable. The local console server could not be reached.'; }
