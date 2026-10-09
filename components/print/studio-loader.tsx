"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type StudioComponent from "@/components/print/studio";

/**
 * The editor needs a browser (a canvas library and the page's fonts) and is
 * the heaviest screen in the dashboard, so it loads on its own, here, and
 * nowhere else.
 */
const Studio = dynamic(() => import("@/components/print/studio"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen items-center justify-center text-sm text-muted" role="status">
      Opening the studio…
    </div>
  ),
});

export function StudioLoader(props: ComponentProps<typeof StudioComponent>) {
  return <Studio {...props} />;
}
