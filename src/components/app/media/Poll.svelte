<script lang="ts" module>
  const endingPolls = new Set<string>();
</script>

<script lang="ts">
  import { getLocalisedText } from "../../../scripts/accessibility/language/translation";
  import type { TimelineEvent } from "../../../scripts/matrix/types";
  import { quintOut } from "svelte/easing";
  import EmojiText from "../../ui/EmojiText.svelte";
  import { now } from "../../../scripts/misc/now";
  import { POLL_END, POLL_RESPONSE, getPoll, pollEndContent, pollResponseContent, tallyPoll } from "../../../scripts/matrix/utilities/content";
  import { fetchRelations, sendRoomEvent } from "../../../scripts/stores/matrix";
  import { entityText, menu } from "../../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../../scripts/misc/icons";
  import { copied, toast } from "../../../scripts/stores/toast";

  let {
    event,
    related,
    ownUserId,
    mayEnd,
  }: { event: TimelineEvent; related: TimelineEvent[]; ownUserId?: string; mayEnd: (sender: string) => boolean } = $props();

  const ENDING = endingPolls;
  const grow = (_: Element) => ({ duration: 420, css: (t: number) => `grid-template-rows: ${t}fr; opacity: ${t};`, easing: quintOut });
  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let fetched: TimelineEvent[] = $state.raw([]);
  let failed = $state(false);
  let loaded = $state(false);

  const poll = $derived(getPoll(event));

  $effect(() => {
    const id = event.event_id;
    if (id.startsWith("~")) return;
    let live = true;
    fetchRelations(id)
      .then((events) => live && ((fetched = events), (loaded = true)))
      .catch(() => live && (failed = true));
    return () => (live = false);
  });

  const merged = $derived.by(() => {
    const seen = new Map<string, TimelineEvent>();
    for (const item of [...fetched, ...related]) seen.set(item.event_id, item);
    return [...seen.values()];
  });

  const tally = $derived(poll ? tallyPoll(poll, event, merged, ownUserId, mayEnd, $now) : null);

  $effect(() => {
    if (!poll || !tally || !loaded || !tally.ended || tally.closed || event.sender !== ownUserId || ENDING.has(event.event_id)) return;
    ENDING.add(event.event_id);
    sendRoomEvent(POLL_END[poll.unstable ? 1 : 0], pollEndContent(event, text("poll", "ended"))).catch(() => ENDING.delete(event.event_id));
  });

  const remaining = $derived.by(() => {
    if (!poll?.endsAt || tally?.ended) return "";
    const minutes = Math.max(1, Math.round((poll.endsAt - $now) / 60000));
    const [value, unit] = minutes >= 1440 ? [Math.round(minutes / 1440), "day"] : minutes >= 60 ? [Math.round(minutes / 60), "hour"] : [minutes, "minute"];
    return text("poll", "ends").replace("{time}", new Intl.RelativeTimeFormat(document.documentElement.lang || undefined, { numeric: "always" }).format(value, unit as Intl.RelativeTimeFormatUnit));
  });
  const reveal = $derived(!!tally && (poll?.disclosed || tally.ended));

  const open = $derived(!!poll && !!tally && !tally.ended && !event.event_id.startsWith("~"));

  const respond = (next: string[]) => {
    if (!poll || !tally || !open) return;
    const current = tally.mine;
    if (next.length === current.length && next.every((pick, index) => pick === current[index])) return;
    sendRoomEvent(POLL_RESPONSE[poll.unstable ? 1 : 0], pollResponseContent(event, next)).catch(() => toast(text("poll", "vote_failed"), { tone: "danger" }));
  };

  const vote = (id: string) => {
    if (!poll || !tally) return;
    const current = tally.mine;
    respond(poll.maxSelections === 1
      ? current.includes(id) ? current : [id]
      : current.includes(id) ? current.filter((pick) => pick !== id) : [...current, id].slice(-poll.maxSelections));
  };

  const results = () =>
    poll && tally ? [poll.question, ...poll.answers.map((answer) => text("poll", "results_line").replace("{option}", answer.text).replace("{count}", votes(tally.counts[answer.id])))].join("\n") : "";

  const pollItems = () => [
    { id: "poll-copy-question", label: entityText("copy_question"), icon: MENU_ICONS.copy, run: () => copied(poll?.question ?? "") },
    ...(reveal ? [{ id: "poll-copy-results", label: text("poll", "copy_results"), icon: MENU_ICONS.poll, run: () => copied(results()) }] : []),
    ...(open && tally?.mine.length ? [{ id: "poll-retract", label: text("poll", "remove_vote"), icon: MENU_ICONS.close, danger: true, separated: true, run: () => respond([]) }] : []),
  ];

  const answerItems = (id: string, label: string) => [
    ...(open && !tally?.mine.includes(id) ? [{ id: "poll-vote", label: text("poll", "vote_for"), icon: MENU_ICONS.read, run: () => vote(id) }] : []),
    ...(open && tally?.mine.includes(id) ? [{ id: "poll-unvote", label: text("poll", "remove_vote"), icon: MENU_ICONS.close, run: () => respond(tally!.mine.filter((pick) => pick !== id)) }] : []),
    { id: "poll-copy-option", label: text("poll", "copy_option"), icon: MENU_ICONS.copy, separated: open, run: () => copied(label) },
    ...pollItems().slice(0, 1),
  ];

  const share = (id: string) => (tally && tally.total ? Math.round((tally.counts[id] / tally.total) * 100) : 0);
  const votes = (count: number) => (count === 1 ? text("poll", "vote") : text("poll", "votes").replace("{count}", String(count)));
</script>

{#if poll && tally}
  <div class="poll set-surface set-panel col" class:ended={tally.ended}>
    <p class="question set-title selectable" use:menu={pollItems}><EmojiText text={poll.question} /></p>
    <p class="hint set-hint">{tally.ended ? text("poll", "ended") : poll.maxSelections > 1 ? text("poll", "pick").replace("{count}", String(poll.maxSelections)) : text("poll", "pick_one")}</p>
    <ul class="answers col" role={poll.maxSelections > 1 ? "group" : "radiogroup"} aria-label={poll.question}>
      {#each poll.answers as answer (answer.id)}
        {@const chosen = tally.mine.includes(answer.id)}
        {@const winner = tally.winners.includes(answer.id)}
        <li class="answer-row" transition:grow>
          <div class="clip">
          <button
            type="button"
            class="answer ghost press row-nw align-centre gap-md"
            class:chosen
            class:winner
            role={poll.maxSelections > 1 ? "checkbox" : "radio"}
            aria-checked={chosen}
            disabled={tally.ended}
            onclick={() => vote(answer.id)}
            use:menu={() => answerItems(answer.id, answer.text)}
            style:--share={reveal ? `${share(answer.id)}%` : "0%"}
          >
            <span class="tick" class:square={poll.maxSelections > 1} aria-hidden="true"></span>
            <span class="label flex-max min-0"><EmojiText text={answer.text} /></span>
            {#if reveal}<span class="count">{votes(tally.counts[answer.id])} · {share(answer.id)}%</span>{/if}
          </button>
          </div>
        </li>
      {/each}
    </ul>
    <p class="footer set-hint" use:menu={pollItems}>
      {#if tally.ended}{text("poll", "final").replace("{count}", votes(tally.total))}
      {:else if !poll.disclosed}{text("poll", "hidden")}
      {:else}{tally.total ? votes(tally.total) : text("poll", "no_votes")}{/if}
      {#if remaining} · {remaining}{/if}
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
    gap: var(--azure-spacing-xs);
  }

  .hint {
    font-size: var(--text-xs);
  }

  .answer-row {
    display: grid;
    grid-template-rows: 1fr;
  }

  .clip {
    min-height: 0;
    overflow: hidden;
    padding-bottom: var(--azure-spacing-sm);
  }

  .answers {
    margin: var(--azure-spacing-md) 0;
    padding: 0;
    list-style: none;
  }

  .answer {
    position: relative;
    width: 100%;
    min-height: 40px;
    padding: var(--azure-spacing-sm) 12px;
    overflow: hidden;
    border-radius: 8px;
    border: 1px solid var(--line);
    font-size: var(--text-md);
    font-weight: 500;
    color: var(--colours-text-strong);
    background-color: var(--fill);
    text-align: start;
    isolation: isolate;
    transition:
      border-color 320ms cubic-bezier(0.32, 0.72, 0, 1),
      background-color 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .answer::before {
    content: "";
    position: absolute;
    inset: 0 auto 0 0;
    z-index: -1;
    width: var(--share);
    background-color: color-mix(in oklab, white 6%, transparent);
    transition:
      width 480ms cubic-bezier(0.32, 0.72, 0, 1),
      background-color 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .answer:not(:disabled):hover {
    background-color: color-mix(in oklab, white 10%, var(--card));
  }

  .answer.chosen {
    border-color: color-mix(in oklab, var(--colours-accent) 60%, transparent);
  }

  .answer.chosen::before,
  .answer.winner::before {
    background-color: var(--colours-accent-faint);
  }

  .answer:disabled {
    cursor: default;
  }

  .tick {
    flex: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background-color: var(--line);
    box-shadow: inset 0 0 0 9px var(--line);
    transition:
      background-color 320ms cubic-bezier(0.32, 0.72, 0, 1),
      box-shadow 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .tick.square {
    border-radius: 5px;
  }

  .chosen .tick {
    background-color: var(--colours-on-accent);
    box-shadow: inset 0 0 0 5px var(--colours-accent);
  }

  .chosen .tick.square {
    box-shadow: inset 0 0 0 4px var(--colours-accent);
  }

  .label {
    overflow-wrap: anywhere;
  }

  .winner .label {
    font-weight: 700;
  }

  .count {
    flex: none;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--colours-text-muted);
    animation: count-in 320ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  @keyframes count-in {
    from {
      opacity: 0;
    }
  }

  @media (max-width: 767px) {
    .answer {
      min-height: var(--azure-touch);
    }
  }
</style>
