import { useEffect, type RefObject } from "react";

/**
 * After a failed submit (each increment of `attempt`), moves focus to the first field marked
 * aria-invalid. Runs after render so the field's error text is already linked via aria-describedby
 * and is announced together with the field.
 */
export function useFocusFirstInvalid(formRef: RefObject<HTMLFormElement | null>, attempt: number) {
  useEffect(() => {
    if (attempt === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [formRef, attempt]);
}
