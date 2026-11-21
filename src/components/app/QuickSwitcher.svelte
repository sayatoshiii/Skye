<script lang="ts">
  import { tick, untrack } from "svelte";
  import { fade, fly } from "svelte/transition";
  import { cubicOut } from "svelte/easing";
  import { baseURL, matrixRequest } from "../../scripts/api/client";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { toEntity } from "../../scripts/stores/entities";
  import { rooms, session } from "../../scripts/stores/matrix";
  import { navigation, openDirect, openJoined, openRoom, switcher } from "../../scripts/stores/navigation.svelte";
  import { joinable, joinVoice, voice } from "../../scripts/stores/voice";
  import { SETTINGS_ICONS } from "../settings/icons";
  import Avatar from "../ui/Avatar.svelte";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { copied } from "../../scripts/stores/toast";
  import { openFullProfile } from "../../scripts/stores/profile";
  import { toMatrixTo } from "../../scripts/matrix/utilities/links";
  import type { MenuItem } from "./MessageMenu.svelte";
  import EmojiText from "../ui/EmojiText.svelte";

  const text = (key: string) => getLocalisedText(undefined, "switcher", key) as string;

  type Kind = "space" | "room" | "voice" | "direct" | "person";
  type Item = { key: string; kind: Kind; id: string; name: string; hint?: string; avatar?: string; unread?: boolean; lower: string; hintLower: string };

  const PREFIXES: Record<string, Kind[]> = { "*": ["space"], "@": ["direct", "person"], "#": ["room"], "!": ["voice"] };
  const RECENT_KEY = "switcher_recent";

  let open = $state(false);
  let query = $state("");
  let active = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLElement | undefined = $state();
  let people = $state.raw<Item[]>([]);
  let recent = $state<string[]>((() => {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    } catch {
      return [];
    }
  })());

  $effect(() => {
    const id = navigation.roomId;
    if (!id) return;
    const next = [id, ...untrack(() => recent).filter((entry) => entry !== id)].slice(0, 12);
    recent = next;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {}
  });

  const prefix = $derived(PREFIXES[query[0]] ? query[0] : "");
  const term = $derived((prefix ? query.slice(1) : query).trim().toLowerCase());
  const kinds = $derived(prefix ? PREFIXES[prefix] : null);

  const all = $derived.by(() =>
    !open ? [] : Object.values($rooms)
      .filter((room) => room.membership === "join")
      .map((room): Item => {
        const entity = toEntity(room, $session?.userId);
        const kind: Kind = room.isSpace ? "space" : room.isDirect ? "direct" : $joinable.has(room.roomId) ? "voice" : "room";
        const hint = room.isDirect ? room.directUserId : entity.alias;
        return { key: room.roomId, kind, id: room.roomId, name: entity.name, hint, avatar: entity.avatar, unread: entity.hasUnread, lower: entity.name.toLowerCase(), hintLower: hint?.toLowerCase() ?? "" };
      }),
  );

  const score = (item: Item) => {
    const name = item.lower;
    const hint = item.hintLower;
    if (!term) return 1;
    if (name === term) return 100;
    if (name.startsWith(term)) return 80;
    if (name.split(/[\s\-_.]+/).some((word) => word.startsWith(term))) return 60;
    if (name.includes(term)) return 40;
    if (hint.includes(term)) return 30;
    let at = 0;
    for (const char of term) if ((at = name.indexOf(char, at) + 1) === 0) return 0;
    return 10;
  };

  const results = $derived.by(() => {
    if (!open) return [];
    if (!term && !prefix) {
      const lookup = new Map(all.map((item) => [item.id, item]));
      return recent.filter((id) => id !== navigation.roomId).flatMap((id) => (lookup.get(id) ? [lookup.get(id)!] : [])).slice(0, 8);
    }
    const known = new Set(all.filter((item) => item.kind === "direct").map((item) => item.hint));
    const pool = [...all, ...people.filter((person) => !known.has(person.id))].filter((item) => !kinds || kinds.includes(item.kind));
    return pool
      .map((item) => ({ item, rank: score(item) + (item.unread ? 2 : 0) + (recent.includes(item.id) ? 5 - recent.indexOf(item.id) * 0.3 : 0) }))
      .filter((entry) => entry.rank > (term ? 2 : 0))
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 12)
      .map((entry) => entry.item);
  });

  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const wanted = term;
    const allowed = !kinds || kinds.includes("person");
    clearTimeout(searchTimer);
    if (!open || wanted.length < 2 || !allowed || !$session) return void (people = []);
    const active = $session;
    searchTimer = setTimeout(() => {
      matrixRequest<{ results: { user_id: string; display_name?: string; avatar_url?: string }[] }>({
        base: baseURL.MATRIX(active.homeserver),
        endpoint: "user_directory/search",
        method: "POST",
        accessToken: active.accessToken,
        body: { search_term: wanted, limit: 10 },
        maxRetries: 0,
      })
        .then((value) => wanted === term && (people = value.results.filter((user) => user.user_id !== active.userId).map((user) => ({ key: `person:${user.user_id}`, kind: "person" as const, id: user.user_id, name: user.display_name || user.user_id, hint: user.user_id, avatar: user.avatar_url, lower: (user.display_name || user.user_id).toLowerCase(), hintLower: user.user_id.toLowerCase() }))))
        .catch(() => undefined);
    }, 250);
  });

  $effect(() => {
    void results;
    active = 0;
  });

  const show = async () => {
    open = true;
    query = "";
    await tick();
    input?.focus();
  };

  const close = () => (open = false);

  $effect(() => void (switcher.nonce && untrack(() => void show())));

  const pick = (item: Item | undefined) => {
    if (!item) return;
    close();
    item.kind === "person"
      ? void openDirect(item.id)
      : item.kind === "space"
        ? openRoom(item.id)
        : (openJoined(item.id), item.kind === "voice" && $voice?.roomId !== item.id && joinVoice(item.id));
  };

  const person = (item: Item) => item.kind === "person" || item.kind === "direct";
  const userOf = (item: Item) => (item.kind === "person" ? item.id : item.hint ?? item.id);
  const itemMenu = (item: Item) => (): MenuItem[] => [
    { id: "switch-open", label: text(item.kind === "person" ? "message" : "open"), icon: item.kind === "person" ? MENU_ICONS.message : MENU_ICONS.jump, run: () => pick(item) },
    ...(item.kind === "voice" ? [{ id: "switch-voice", label: text("join_voice"), icon: SETTINGS_ICONS.headphones, run: () => (close(), openJoined(item.id), joinVoice(item.id)) }] : []),
    ...(person(item) ? [{ id: "switch-profile", label: text("view_profile"), icon: MENU_ICONS.profile, run: () => (close(), openFullProfile(userOf(item))) }] : []),
    { id: "switch-name", label: text("copy_name"), icon: MENU_ICONS.copy, separated: true, run: () => copied(item.name) },
    { id: "switch-link", label: text("copy_link"), icon: MENU_ICONS.link, run: () => copied(person(item) ? `https://matrix.to/#/${userOf(item)}` : toMatrixTo(item.hint?.startsWith("#") ? item.hint : item.id)) },
    { id: "switch-id", label: text("copy_id"), icon: MENU_ICONS.id, run: () => copied(person(item) ? userOf(item) : item.id, "id_copied", "id") },
  ];

  const move = (step: number) => {
    if (!results.length) return;
    active = (active + step + results.length) % results.length;
    tick().then(() => list?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }));
  };

  const onkeydown = (event: KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    const typing = event.target instanceof HTMLElement && event.target !== input && (event.target.isContentEditable || ["INPUT", "TEXTAREA"].includes(event.target.tagName));
    if (mod && !event.altKey && !event.shiftKey && !typing && event.key.toLowerCase() === "k") return (event.preventDefault(), open ? close() : !document.querySelector('[aria-modal="true"], .confirm-layer') && void show());
    if (!open) return;
    event.key === "Escape" && (event.preventDefault(), event.stopPropagation(), close());
    event.key === "ArrowDown" && (event.preventDefault(), move(1));
    event.key === "ArrowUp" && (event.preventDefault(), move(-1));
    event.key === "Enter" && (event.preventDefault(), pick(results[active]));
  };

  const ICONS: Record<Kind, string> = { space: "M4 5h16v14H4z", room: "M5 9h14M5 15h14M10 4 8 20M16 4l-2 16", voice: SETTINGS_ICONS.speaker, direct: "", person: "" };
  const LABELS: Record<Kind, string> = { space: "space", room: "room", voice: "voice", direct: "direct", person: "person" };
</script>

<svelte:window onkeydowncapture={onkeydown} />

{#if open}
  <div class="layer" role="presentation" transition:fade={{ duration: 150, easing: cubicOut }} onpointerdown={(event) => event.target === event.currentTarget && close()}>
    <div class="switcher col" role="dialog" aria-modal="true" aria-label={text("title")} in:fly={{ y: -8, duration: 260, easing: cubicOut }} out:fly={{ y: -6, duration: 150, easing: cubicOut }}>
      <input bind:this={input} bind:value={query} class="query" type="text" spellcheck="false" autocomplete="off" placeholder={text("placeholder")} aria-label={text("placeholder")} aria-controls="switcher-results" aria-activedescendant={results.length ? `switcher-${active}` : undefined} />
      {#if !term && !prefix && results.length}<p class="section xs bold">{text("recent")}</p>{/if}
      <ul class="results col" id="switcher-results" role="listbox" bind:this={list}>
        {#each results as item, index (item.key)}
          <li role="option" id={`switcher-${index}`} aria-selected={index === active} data-index={index}>
            <button type="button" class="result row-nw align-centre gap-sm ghost" class:on={index === active} onpointermove={() => (active = index)} onclick={() => pick(item)} use:menu={itemMenu(item)}>
              {#if item.kind === "direct" || item.kind === "person" || item.kind === "space" || item.avatar}
                <Avatar name={item.name} url={item.avatar} size="24px" radius={item.kind === "direct" || item.kind === "person" ? "50%" : "7px"} />
              {:else}
                <svg class="glyph" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  {#if item.kind === "voice"}<path fill="currentColor" d={ICONS.voice} />{:else}<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d={ICONS[item.kind]} />{/if}
                </svg>
              {/if}
              <span class="name md truncate" class:unread={item.unread}><EmojiText text={item.name} fade={false} /></span>
              {#if item.hint && item.hint !== item.name}<span class="hint sm faint truncate">{item.hint}</span>{/if}
              <span class="kind xs faint">{text(LABELS[item.kind])}</span>
            </button>
          </li>
        {:else}
          <li class="empty sm faint">{term || prefix ? text("none") : text("start")}</li>
        {/each}
      </ul>
      <p class="tip xs muted"><span class="bold accent">{text("protip")}</span> {text("tip")} <kbd>@</kbd> <kbd>#</kbd> <kbd>!</kbd> <kbd>*</kbd></p>
    </div>
  </div>
{/if}

<style>
  .layer {
    position: fixed;
    inset: 0;
    overflow: hidden;
    z-index: var(--azure-z-overlay);
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    place-items: start center;
    padding: 14vh var(--azure-spacing-md) var(--azure-spacing-md);
    background-color: color-mix(in oklab, black 60%, transparent);
  }

  .switcher {
    width: min(100%, 560px);
    min-width: 0;
    max-width: 100%;
    max-height: min(520px, 76vh);
    padding: var(--azure-spacing-md);
    gap: var(--azure-spacing-sm);
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-foreground);
    box-shadow: 0 16px 36px rgb(0 0 0 / 0.45);
  }

  .query {
    flex: none;
    height: 52px;
    padding: 0 var(--azure-spacing-md);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-border);
    background-color: var(--colours-surface);
    color: var(--colours-text-strong);
    font: inherit;
    font-size: 18px;
    outline: none;
    transition: border-color 220ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .query:focus {
    border-color: var(--colours-accent);
  }

  .section,
  .tip {
    flex: none;
  }

  .section {
    margin: var(--azure-spacing-xs) var(--azure-spacing-sm) 0;
    color: var(--colours-text-muted);
  }

  .results {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .result {
    width: 100%;
    min-width: 0;
    overflow: hidden;
    min-height: 40px;
    padding: 6px 10px;
    border-radius: var(--azure-radius-sm);
    text-align: left;
    color: var(--colours-text-muted);
    transition: background-color 160ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .result:hover {
    background-color: color-mix(in oklab, var(--colours-surface-hover) 60%, transparent);
    color: var(--colours-text-strong);
  }

  .result.on {
    background-color: var(--colours-surface-hover);
    color: var(--colours-text-strong);
  }

  .glyph {
    flex: none;
    width: 24px;
    color: var(--colours-text-faint);
  }

  .name {
    min-width: 0;
  }

  .name.unread {
    color: var(--colours-text-strong);
    font-weight: 600;
  }

  .hint {
    flex: 1;
    min-width: 0;
  }

  .kind {
    margin-left: auto;
    flex: none;
    opacity: 0;
    transition: opacity 160ms ease;
  }

  .result.on .kind {
    opacity: 1;
  }

  .empty {
    padding: var(--azure-spacing-lg) var(--azure-spacing-sm);
    text-align: center;
  }

  .tip {
    margin: 0;
    padding-top: var(--azure-spacing-xs);
  }

  .accent {
    color: var(--colours-success);
  }

  kbd {
    padding: 1px 5px;
    border-radius: 4px;
    background-color: var(--colours-surface);
    font-family: inherit;
  }

  @media (prefers-reduced-motion: reduce) {
    .result,
    .query {
      transition: none;
    }
  }
</style>
