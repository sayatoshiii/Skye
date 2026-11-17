<script lang="ts">
  import { swap } from "../../scripts/misc/swap";
  import { getMediaLink, isMxc } from "../../scripts/matrix/utilities/media";

  let {
    name = "",
    url,
    size = "40px",
    radius = "25%",
  }: { name?: string; url?: string; size?: string; radius?: string } =
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

  $effect(() => {
    const source = url;
    failed = false;
    resolved = isMxc(source) ? undefined : source;
    if (!isMxc(source) || !visible) return;

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
  {#if resolved && !failed}
    <img src={resolved} alt="" loading="lazy" onerror={() => (failed = true)} />
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
</style>
