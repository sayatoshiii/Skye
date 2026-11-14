<script lang="ts">
  let {
    name = "",
    url,
    size = "40px",
    radius = "25%",
  }: { name?: string; url?: string; size?: string; radius?: string } =
    $props();

  let failed = $state(false);

  const initials = $derived(
    name
      .replace(/^[@#!]/, "")
      .split(/\s+/)
      .map((word) => word[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
  );
</script>

<span class="avatar" style:--size={size} style:--radius={radius}>
  {#if url && !failed}
    <img src={url} alt="" loading="lazy" onerror={() => (failed = true)} />
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
