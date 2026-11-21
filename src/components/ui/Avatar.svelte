<script lang="ts">
  import { swap } from "../../scripts/misc/swap";
  import { getMediaLink, isMxc, knownMediaLink } from "../../scripts/matrix/utilities/media";

  let {
    name = "",
    url,
    size = "40px",
    radius = "25%",
    fade = false,
  }: { name?: string; url?: string; size?: string; radius?: string; fade?: boolean } =
    $props();

  let failed = $state(false);
  let resolved = $state<string | undefined>();
  let element: HTMLSpanElement | undefined = $state();
  let visible = $state(false);

  $effect(() => {
    if (!element || visible) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      visible = true;
      observer.disconnect();
    }, { rootMargin: "200px" });

    observer.observe(element);
    return () => observer.disconnect();
  });

  const initials = $derived(
    name
      .replace(/^[@#!]/, "")
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
  );

  let last: string | undefined;

  $effect(() => {
    const source = url;
    source !== last && ((failed = false), (resolved = isMxc(source) ? knownMediaLink(source) : source), (last = source));
    if (!isMxc(source) || !visible || resolved) return;

    let current = true;
    getMediaLink(source).then((link) => {
      if (current) resolved = link;
    });

    return () => {
      current = false;
    };
  });
</script>

<span class="avatar" use:swap={url} bind:this={element} style:--size={size} style:--radius={radius}>
  {#if resolved && !failed && fade}
    <span aria-hidden="true">{initials}</span>
    <img class="fade" src={resolved} alt="" onload={(event) => event.currentTarget.classList.add("loaded")} onerror={() => (failed = true)} />
  {:else if resolved && !failed}
    <img src={resolved} alt="" decoding="sync" onerror={() => (failed = true)} />
  {:else}
    <span aria-hidden="true">{initials}</span>
  {/if}
</span>

<style>
  .avatar {
    width: var(--size);
    height: var(--size);
    flex: none;

    display: grid;
    place-items: center;

    border-radius: var(--radius);
    overflow: hidden;

    font-size: calc(var(--size) * 0.36);
    font-weight: 600;
    color: var(--colours-text-strong);
    background: linear-gradient(
      160deg,
      var(--colours-surface-raised),
      var(--colours-surface)
    );
    transition: border-radius var(--azure-duration-md) var(--azure-ease-out);
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar > * {
    grid-area: 1 / 1;
  }

  .fade {
    opacity: 0;
    filter: blur(6px);
    scale: 1.06;
    transition:
      opacity 420ms cubic-bezier(0.32, 0.72, 0, 1),
      filter 420ms cubic-bezier(0.32, 0.72, 0, 1),
      scale 420ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .fade:global(.loaded) {
    opacity: 1;
    filter: none;
    scale: 1;
  }
</style>
