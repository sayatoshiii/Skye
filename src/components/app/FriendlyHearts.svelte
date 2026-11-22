<script lang="ts">
  import { tick } from "svelte";
  import { heartSet, heartsOn, isFriendly } from "../../scripts/misc/hearts";
  import { renderEmoji } from "../../scripts/misc/emoji";
  import { portal } from "../../scripts/misc/portal";

  type Entry = { id: string; ts: number; plain?: boolean; body?: string; eventId: string };
  type Heart = { key: number; emoji: string; x: number; y: number; drift: number; size: number; delay: number; spin: number };

  let { messages, timeline }: { messages: Entry[]; timeline?: HTMLElement } = $props();

  const LIVE = 20000;
  const seen = new Set<string>();
  let hearts = $state<Heart[]>([]);
  let count = 0;
  let primed = false;

  const burst = async (message: Entry) => {
    await tick();
    const row = timeline?.querySelector<HTMLElement>(`li[data-event-id="${CSS.escape(message.eventId)}"]`);
    const box = row?.querySelector<HTMLElement>(".content")?.getBoundingClientRect() ?? row?.getBoundingClientRect();
    if (!row || !box || !box.width) return;
    row.classList.remove("friendly-glow", "motion-keep");
    void row.offsetWidth;
    row.classList.add("friendly-glow", "motion-keep");
    setTimeout(() => row.classList.remove("friendly-glow", "motion-keep"), 1800);
    const set = heartSet();
    const amount = 4 + Math.floor(Math.random() * 3);
    const start = box.left + Math.min(box.width, 160) / 2;
    const fresh = Array.from({ length: amount }, (_, index) => ({
      key: ++count,
      emoji: set[index % set.length],
      x: start + (Math.random() - 0.5) * 70,
      y: box.top + box.height / 2,
      drift: (Math.random() - 0.5) * 50,
      size: 14 + Math.random() * 8,
      delay: index * 70 + Math.random() * 60,
      spin: (Math.random() - 0.5) * 30,
    }));
    hearts = [...hearts, ...fresh];
  };

  const done = (key: number) => (hearts = hearts.filter((heart) => heart.key !== key));

  $effect(() => {
    const now = Date.now();
    const on = primed && $heartsOn;
    for (const message of messages) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      if (on && now - message.ts < LIVE && message.plain && isFriendly(message.body)) burst(message);
    }
    primed ||= messages.length > 0;
  });
</script>

{#if hearts.length}
  <span class="portal-anchor" hidden></span>
  <div class="hearts" aria-hidden="true" use:portal>
    {#each hearts as heart (heart.key)}
      <span class="heart motion-keep" style="left: {heart.x}px; top: {heart.y}px; font-size: {heart.size}px; --drift: {heart.drift}px; --spin: {heart.spin}deg; animation-delay: {heart.delay}ms" onanimationend={() => done(heart.key)}>{@html renderEmoji(heart.emoji)}</span>
    {/each}
  </div>
  <span class="portal-anchor" hidden></span>
{/if}

<style>
  .hearts {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 40;
    overflow: hidden;
  }

  .heart {
    position: absolute;
    line-height: 1;
    opacity: 0;
    will-change: transform, opacity, filter;
    animation: rise 1500ms cubic-bezier(0.32, 0.72, 0, 1) both;
  }

  .heart :global(img) {
    display: block;
    width: 1em;
    height: 1em;
  }

  @keyframes rise {
    0% {
      opacity: 0;
      filter: blur(3px);
      transform: translate(-50%, -50%) translate(0, 6px) scale(0.4) rotate(0deg);
    }
    18% {
      opacity: 1;
      filter: blur(0);
      transform: translate(-50%, -50%) translate(calc(var(--drift) * 0.25), -14px) scale(1) rotate(calc(var(--spin) * 0.3));
    }
    100% {
      opacity: 0;
      filter: blur(2px);
      transform: translate(-50%, -50%) translate(var(--drift), -84px) scale(0.85) rotate(var(--spin));
    }
  }

  :global(li.friendly-glow) {
    animation: friendly-glow 1800ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  @keyframes -global-friendly-glow {
    0%, 100% {
      background-color: transparent;
    }
    30% {
      background-color: color-mix(in srgb, #ff6b9a 7%, transparent);
    }
  }
</style>
