import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge doesn't know our custom `@utility text-*` type-ramp classes
// (theme.css) are font-size utilities, not text-color utilities — without
// this it silently drops text-body/text-card-title/etc. whenever they're
// combined with a text-color class (e.g. "text-body text-muted-foreground").
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["page-title", "section-title", "card-title", "body", "caption", "code"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
