/**
 * Visible "(required)" suffix for a field label. Hidden from assistive tech because the
 * field itself carries aria-required, which screen readers already announce.
 */
export function RequiredMark() {
  return (
    <span aria-hidden="true" className="font-normal text-muted-foreground">
      (required)
    </span>
  );
}
