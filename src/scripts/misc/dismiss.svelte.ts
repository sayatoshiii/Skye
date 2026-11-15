const DISMISS_FALLBACK = 600;

export const dismissible = (finish: () => void) => {
  let closing = $state(false);
  let settled = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const done = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    finish();
    closing = false;
  };

  $effect(() => () => {
    settled = true;
    clearTimeout(timer);
  });

  return {
    get closing() {
      return closing;
    },
    close: () => {
      if (closing) return;
      closing = true;
      settled = false;
      timer = setTimeout(done, DISMISS_FALLBACK);
    },
    onanimationend: (event: AnimationEvent) => {
      if (closing && event.target === event.currentTarget) done();
    },
  };
};
