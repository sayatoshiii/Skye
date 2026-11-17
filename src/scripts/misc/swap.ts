export const swap = (node: HTMLElement, value: unknown) => {
  let last = value;
  const done = (event: AnimationEvent) => event.animationName.includes("blur-swap") && node.classList.remove("blur-swap");
  node.addEventListener("animationend", done);
  return {
    update: (next: unknown) =>
      void (next !== last && ((last = next), node.classList.remove("blur-swap"), void node.offsetWidth, node.classList.add("blur-swap"))),
    destroy: () => node.removeEventListener("animationend", done),
  };
};
