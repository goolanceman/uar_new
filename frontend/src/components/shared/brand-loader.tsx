import { cn } from "@/lib/utils";
import { useBranding } from "@/hooks/use-branding";

/**
 * The hummingbird mark, spinning. Used wherever a page or action is waiting
 * on data, in place of a generic ring.
 */
export function BrandLoader({
  className,
  label,
}: {
  className?: string;
  label?: string;
}) {
  const { name } = useBranding();
  return (
    <span role="status" aria-label={label ?? `Loading ${name}`} className={cn("inline-flex", className)}>
      <img src="/brand/logo-mark.svg" alt="" className="size-full animate-spin object-contain" />
    </span>
  );
}
