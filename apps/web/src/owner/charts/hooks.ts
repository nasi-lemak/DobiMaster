import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/** Width of an element, kept current with ResizeObserver (charts are laid out in real pixels). */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Hover/focus index for charts with an X position: the pointer snaps to the nearest column; keyboard
 * users focus the chart and move with ←/→ (Home/End), getting the same tooltip as on hover.
 */
export function useActiveIndex(n: number, onKeyboardMove?: (i: number | null) => void) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    if (!n) return;
    const cur = active ?? -1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1);
    else if (e.key === 'ArrowLeft') next = Math.max(0, cur < 0 ? n - 1 : cur - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    else if (e.key === 'Escape') {
      setActive(null);
      onKeyboardMove?.(null);
      return;
    }
    if (next != null) {
      e.preventDefault();
      setActive(next);
      onKeyboardMove?.(next);
    }
  };
  return { active, setActive, onKeyDown };
}

/** SVG path of a rect whose top corners are rounded (data-end) and bottom is square (baseline). */
export function roundedTop(x: number, y: number, w: number, h: number, r = 4) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}
