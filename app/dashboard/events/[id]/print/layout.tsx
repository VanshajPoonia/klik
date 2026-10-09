import { printFontVariables } from "./fonts";

/** The studio's typefaces, as CSS variables the canvas reads (`lib/print/studio-env.ts`). */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-print-fonts className={`${printFontVariables} flex min-h-screen flex-col`}>
      {children}
    </div>
  );
}
