<script lang="ts">
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import type { TimelineEvent } from "../../../scripts/matrix/types";
  import { POLL_RESPONSE, getPoll, pollResponseContent, tallyPoll } from "../../../scripts/matrix/utilities/content";
  import { fetchRelations, sendRoomEvent } from "../../../scripts/stores/matrix";

  let {
    event,
    related,
    ownUserId,
    mayEnd,
  }: { event: TimelineEvent; related: TimelineEvent[]; ownUserId?: string; mayEnd: (sender: string) => boolean } = $props();

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let fetched: TimelineEvent[] = $state.raw([]);
  let failed = $state(false);

  const poll = $derived(getPoll(event));

  $effect(() => {
    const id = event.event_id;
    if (id.startsWith("~")) return;
    let live = true;
    fetchRelations(id)
      .then((events) => live && (fetched = events))
      .catch(() => live && (failed = true));
    return () => (live = false);
  });

  const merged = $derived.by(() => {
    const seen = new Map<string, TimelineEvent>();
    for (const item of [...fetched, ...related]) seen.set(item.event_id, item);
    return [...seen.values()];
  });

  const tally = $derived(poll ? tallyPoll(poll, event, merged, ownUserId, mayEnd) : null);
  const reveal = $derived(!!tally && (poll?.disclosed || tally.ended));

  const vote = (id: string) => {
    if (!poll || !tally || tally.ended || event.event_id.startsWith("~")) return;
    const current = tally.mine;
    const next = poll.maxSelections === 1
      ? current.includes(id) ? current : [id]
      : current.includes(id) ? current.filter((pick) => pick !== id) : [...current, id].slice(-poll.maxSelections);
    if (next.length === current.length && next.every((pick, index) => pick === current[index])) return;
    sendRoomEvent(POLL_RESPONSE[poll.unstable ? 1 : 0], pollResponseContent(event, next)).catch(() => undefined);
  };

  const share = (id: string) => (tally && tally.total ? Math.round((tally.counts[id] / tally.total) * 100) : 0);
  const votes = (count: number) => (count === 1 ? text("poll", "vote") : text("poll", "votes").replace("{count}", String(count)));
</script>

{#if poll && tally}
  <div class="poll col" class:ended={tally.ended}>
    <p class="question md bold selectable">{poll.question}</p>
    <p class="hint xs faint">{tally.ended ? text("poll", "ended") : poll.maxSelections > 1 ? text("poll", "pick").replace("{count}", String(poll.maxSelections)) : text("poll", "pick_one")}</p>
    <ul class="answers col" role={poll.maxSelections > 1 ? "group" : "radiogroup"} aria-label={poll.question}>
      {#each poll.answers as answer (answer.id)}
        {@const chosen = tally.mine.includes(answer.id)}
        {@const winner = tally.winners.includes(answer.id)}
        <li>
          <button
            type="button"
            class="answer ghost row-nw align-centre gap-sm"
            class:chosen
            class:winner
            role={poll.maxSelections > 1 ? "checkbox" : "radio"}
            aria-checked={chosen}
            disabled={tally.ended}
            onclick={() => vote(answer.id)}
            style:--share={reveal ? `${share(answer.id)}%` : "0%"}
          >
            <span class="tick" class:square={poll.maxSelections > 1} aria-hidden="true"></span>
            <span class="label sm flex-max min-0">{answer.text}</span>
            {#if reveal}<span class="count xs faint">{votes(tally.counts[answer.id])} · {share(answer.id)}%</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
    <p class="footer xs faint">
      {#if tally.ended}{text("poll", "final").replace("{count}", votes(tally.total))}
      {:else if !poll.disclosed}{text("poll", "hidden")}
      {:else}{tally.total ? votes(tally.total) : text("poll", "no_votes")}{/if}
      {#if failed} · {text("poll", "failed")}{/if}
    </p>
  </div>
{:else}
  <p class="xs faint">{text("poll", "unavailable")}</p>
{/if}

<style>
  .poll {
    width: min(100%, 420px);
    margin-top: var(--azure-spacing-sm);
    padding: var(--azure-spacing-md);
    gap: var(--azure-spacing-xs);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-surface);
  }

  .question {
    margin: 0;
    color: var(--colours-text-strong);
  }

  .hint,
  .footer {
    margin: 0;
  }

  .answers {
    gap: var(--azure-spacing-xs);
    margin: var(--azure-spacing-xs) 0;
    padding: 0;
    list-style: none;
  }

  .answer {
    position: relative;
    width: 100%;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    overflow: hidden;
    border-radius: var(--azure-radius-sm);
    border: 1px solid var(--colours-outline-hairline);
    text-align: start;
    isolation: isolate;
    transition: border-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .answer::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    z-index: -1;
    width: var(--share);
    background-color: var(--colours-surface-hover);
    transition: width var(--azure-duration-md) var(--azure-ease-out);
  }

  .answer:not(:disabled):hover {
    border-color: var(--colours-outline-light);
  }

  .answer.chosen {
    border-color: var(--colours-accent);
  }

  .answer.chosen::before,
  .answer.winner::before {
    background-color: var(--colours-accent-faint);
  }

  .answer.winner .label {
    font-weight: 700;
    color: var(--colours-text-strong);
  }

  .answer:disabled {
    cursor: default;
  }

  .tick {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid var(--colours-outline-light);
    transition: background-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .tick.square {
    border-radius: 4px;
  }

  .chosen .tick {
    border-color: var(--colours-accent);
    background-color: var(--colours-accent);
    box-shadow: inset 0 0 0 2px var(--colours-surface);
  }

  .label {
    overflow-wrap: anywhere;
  }

  .count {
    flex: none;
  }

  @media (max-width: 767px) {
    .answer {
      min-height: var(--azure-touch);
    }
  }
</style>
