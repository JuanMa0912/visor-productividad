import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

/** Sincroniza el valor del DOM con React (autocompletado del navegador). */
export function useDomInputSync(
  setValue: Dispatch<SetStateAction<string>>,
) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;

    const sync = () => {
      setValue((prev) => (input.value !== prev ? input.value : prev));
    };

    sync();

    const interval = window.setInterval(sync, 250);
    const stopPolling = window.setTimeout(() => clearInterval(interval), 10000);

    const onAnimationStart = (event: AnimationEvent) => {
      if (event.animationName === "vp-autofill-sync") sync();
    };
    input.addEventListener("animationstart", onAnimationStart);

    return () => {
      clearInterval(interval);
      clearTimeout(stopPolling);
      input.removeEventListener("animationstart", onAnimationStart);
    };
  }, [setValue]);

  return ref;
}
