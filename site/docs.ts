/**
 * Progressive enhancements for the docs below the demo. Without JS, every tab
 * panel shows (each under its own label) and code has no copy button.
 */

let nextId = 0;

/**
 * Turns each `.tabs` group of `.tab-panel`s into an ARIA tab set: one
 * `.tab-label` per panel becomes its tab, and the arrow keys (plus Home/End)
 * move between them.
 */
function enhanceTabs(group: HTMLElement) {
  const panels = [
    ...group.querySelectorAll<HTMLElement>(':scope > .tab-panel'),
  ];
  const list = document.createElement('div');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', group.dataset['label'] ?? 'Examples');

  const tabs = panels.map((panel, i) => {
    const id = `tabs-${nextId++}`;
    const label = panel.querySelector<HTMLElement>(':scope > .tab-label');
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.id = `${id}-tab`;
    tab.textContent = label?.textContent ?? `Tab ${i + 1}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `${id}-panel`);
    tab.addEventListener('click', () => select(i));
    label?.remove();

    panel.id = `${id}-panel`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    panel.tabIndex = 0;
    return tab;
  });

  function select(index: number, focus = false) {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[i]!.hidden = !selected;
    });
    if (focus) tabs[index]!.focus();
  }

  list.addEventListener('keydown', (event) => {
    const current = tabs.indexOf(event.target as HTMLButtonElement);
    const last = tabs.length - 1;
    const next = {
      ArrowRight: current === last ? 0 : current + 1,
      ArrowLeft: current === 0 ? last : current - 1,
      Home: 0,
      End: last,
    }[event.key];
    if (current === -1 || next === undefined) return;
    event.preventDefault();
    select(next, true);
  });

  list.append(...tabs);
  group.prepend(list);
  select(0);
}

/** Adds a copy button to each code block, where the clipboard is available */
function addCopyButton(block: HTMLElement) {
  const code = block.querySelector('code');
  if (!code || !navigator.clipboard) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy';
  button.textContent = 'Copy';
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent ?? '');
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Failed';
    }
    setTimeout(() => (button.textContent = 'Copy'), 1500);
  });
  block.append(button);
}

/** Opens the `<details>` a link points into, so `#caching` lands somewhere */
function openTarget() {
  const id = location.hash.slice(1);
  const target = id ? document.getElementById(id) : null;
  const details = target?.closest('details');
  if (target && details && !details.open) {
    details.open = true;
    target.scrollIntoView();
  }
}

export function enhanceDocs() {
  document.querySelectorAll<HTMLElement>('.tabs').forEach(enhanceTabs);
  document.querySelectorAll<HTMLElement>('.code-block').forEach(addCopyButton);
  openTarget();
  addEventListener('hashchange', openTarget);
}
