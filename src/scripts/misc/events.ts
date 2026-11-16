export type Listener<T> = (payload: T) => void;

export const createEmitter = <Events extends Record<string, unknown>>() => {
  const listeners: { [K in keyof Events]?: Set<Listener<Events[K]>> } = {};

  const on = <K extends keyof Events>(
    event: K,
    listener: Listener<Events[K]>,
  ) => {
    (listeners[event] ??= new Set()).add(listener);
    return () => off(event, listener);
  };

  const off = <K extends keyof Events>(
    event: K,
    listener: Listener<Events[K]>,
  ) => listeners[event]?.delete(listener);

  const emit = <K extends keyof Events>(event: K, payload: Events[K]) =>
    listeners[event]?.forEach((listener) => {
      try {
        listener(payload);
      } catch (error) {
        console.error(`Listener for "${String(event)}" failed`, error);
      }
    });

  return { on, off, emit };
};

export type Emitter<Events extends Record<string, unknown>> = ReturnType<
  typeof createEmitter<Events>
>;
