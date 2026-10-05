// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KnowledgePage } from './KnowledgePage';

describe('KnowledgePage', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render() {
    act(() => {
      root.render(<KnowledgePage />);
    });
  }

  it('renders the legend, stats and the default node detail', () => {
    render();

    expect(container.textContent).toContain('标准 / 接口');
    expect(container.textContent).toContain('40 个节点 · 74 条关系');
    expect(container.textContent).toContain('智能卡规范体系');
    expect(container.textContent).toContain('Smart Card standards ecosystem');

    // One label per node in the SVG canvas.
    expect(container.querySelectorAll('svg text').length).toBe(40);

    const legendButtons = container.querySelectorAll(
      '[data-testid="knowledge-legend"] button',
    );
    expect(legendButtons.length).toBe(5);
  });

  it('selects a matching node when searching', () => {
    render();

    const input = container.querySelector<HTMLInputElement>(
      '[aria-label="搜索节点"]',
    );
    expect(input).not.toBeNull();
    if (!input) return;

    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;

    act(() => {
      valueSetter?.call(input, 'FIDO2');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(container.textContent).toContain('身份认证协议与凭据');
  });

  it('navigates to a related node from the detail panel', () => {
    render();

    const relatedButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '标准与接口',
    );
    expect(relatedButton).toBeDefined();

    act(() => {
      relatedButton?.click();
    });

    expect(container.textContent).toContain('卡片、射频、传输与终端接口规范');
  });

  it('toggles a category from the legend', () => {
    render();

    const firstLegendButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="knowledge-legend"] button',
    );
    expect(firstLegendButton).not.toBeNull();
    if (!firstLegendButton) return;

    const classNameBefore = firstLegendButton.className;
    act(() => {
      firstLegendButton.click();
    });
    expect(firstLegendButton.className).not.toBe(classNameBefore);
  });
});
