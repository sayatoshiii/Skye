export const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const spring = (response = 0.45, damping = 0.65, velocity = 0) => {
  const omega = (2 * Math.PI) / response;
  const decay = damping * omega;
  const damped = omega * Math.sqrt(1 - damping * damping);
  const settle = -Math.log(0.005) / decay;
  const at = (seconds: number) => 1 - Math.exp(-decay * seconds) * (Math.cos(damped * seconds) + ((decay - velocity) / damped) * Math.sin(damped * seconds));
  return { duration: Math.round(settle * 1000), ease: (t: number) => (t >= 1 ? 1 : at(t * settle)) };
};

export const springFrames = (response: number, damping: number, velocity: number, frame: (value: number) => Keyframe, steps = 36) => {
  const { duration, ease } = spring(response, damping, velocity);
  return { duration, frames: Array.from({ length: steps + 1 }, (_, step) => frame(ease(step / steps))) };
};
