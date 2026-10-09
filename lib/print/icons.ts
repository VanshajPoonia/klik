/**
 * QR-4c: the studio's small icon library, drawn here as filled paths on a 24
 * unit square so they print sharp at any size. Holes (a camera's lens, a
 * ring's middle) are drawn in the opposite direction to their outline, which
 * cuts them out under the default fill rule.
 */

function starPath(points: number, outer: number, inner: number): string {
  const steps = points * 2;
  const parts: string[] = [];
  for (let index = 0; index < steps; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (Math.PI * index) / points - Math.PI / 2;
    const x = 12 + radius * Math.cos(angle);
    const y = 12 + radius * Math.sin(angle);
    parts.push(`${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`);
  }
  return `${parts.join(" ")} Z`;
}

export const PRINT_ICONS = {
  heart: {
    label: "Heart",
    path: "M12 21 C12 21 3 14.5 3 8.6 C3 5.5 5.4 3.5 8 3.5 C9.8 3.5 11.2 4.5 12 6 C12.8 4.5 14.2 3.5 16 3.5 C18.6 3.5 21 5.5 21 8.6 C21 14.5 12 21 12 21 Z",
  },
  star: { label: "Star", path: starPath(5, 10, 4.2) },
  sparkle: {
    label: "Sparkle",
    path: "M12 2 C12.8 8 16 11.2 22 12 C16 12.8 12.8 16 12 22 C11.2 16 8 12.8 2 12 C8 11.2 11.2 8 12 2 Z",
  },
  camera: {
    label: "Camera",
    path: "M4 7 H7.2 L9 4.5 H15 L16.8 7 H20 A2 2 0 0 1 22 9 V18.5 A2 2 0 0 1 20 20.5 H4 A2 2 0 0 1 2 18.5 V9 A2 2 0 0 1 4 7 Z M12 9.2 A4.3 4.3 0 1 0 12 17.8 A4.3 4.3 0 1 0 12 9.2 Z",
  },
  phone: {
    label: "Phone",
    path: "M8 2 H16 A2.5 2.5 0 0 1 18.5 4.5 V19.5 A2.5 2.5 0 0 1 16 22 H8 A2.5 2.5 0 0 1 5.5 19.5 V4.5 A2.5 2.5 0 0 1 8 2 Z M7.5 5 V18 H16.5 V5 Z",
  },
  scan: {
    label: "Scan frame",
    path: "M3 3 H9 V5 H5 V9 H3 Z M15 3 H21 V9 H19 V5 H15 Z M3 15 H5 V19 H9 V21 H3 Z M19 15 H21 V21 H15 V19 H19 Z",
  },
  rings: {
    label: "Rings",
    path: "M9 6 A6 6 0 1 1 9 18 A6 6 0 1 1 9 6 Z M9 8 A4 4 0 1 0 9 16 A4 4 0 1 0 9 8 Z M15 6 A6 6 0 1 1 15 18 A6 6 0 1 1 15 6 Z M15 8 A4 4 0 1 0 15 16 A4 4 0 1 0 15 8 Z",
  },
  "arrow-down": { label: "Arrow down", path: "M10 3 H14 V13.5 H18.5 L12 21 L5.5 13.5 H10 Z" },
  "arrow-right": { label: "Arrow right", path: "M3 10 H13.5 V5.5 L21 12 L13.5 18.5 V14 H3 Z" },
} as const;

export type PrintIconKey = keyof typeof PRINT_ICONS;

export const PRINT_ICON_KEYS = Object.keys(PRINT_ICONS) as [PrintIconKey, ...PrintIconKey[]];

/** The square every icon path is drawn on. */
export const ICON_BOX = 24;
