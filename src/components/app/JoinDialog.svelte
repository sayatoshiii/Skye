<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { joinRoom, knockRoom } from "../../scripts/matrix/utilities/hierarchy";
  import { parseRoomLink, type RoomLink } from "../../scripts/matrix/utilities/links";
  import {
    describeMembershipError,
    resolveLink,
    type MembershipError,
    type ResolvedLink,
  } from "../../scripts/matrix/utilities/membership";
  import type { RoomSummary, Session } from "../../scripts/matrix/types";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { ownProfile, rooms, session, waitForRoom, type Profile } from "../../scripts/stores/matrix";
  import { uploadBytes } from "../../scripts/matrix/utilities/attachments";
  import { createSpace } from "../../scripts/matrix/utilities/creation";
  import { OWN_SPACE as OWN, SPACE_AUDIENCES, SPACE_TEMPLATES as TEMPLATES, type SpaceAudience, type SpaceTemplate as Template } from "../../scripts/settings/spaces";
  import { getEmojiURL } from "../../scripts/misc/emoji";
  import { openJoined } from "../../scripts/stores/navigation.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import { entityText, menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { copied } from "../../scripts/stores/toast";
  import { toMatrixTo } from "../../scripts/matrix/utilities/links";
  import type { MenuItem } from "./MessageMenu.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import AvatarPicker from "../ui/AvatarPicker.svelte";

  let { onclose }: { onclose: () => void } = $props();

  type Step = "start" | "join" | "audience" | "create";
  type Status = "idle" | "looking" | "ready" | "joining" | "waiting" | "requested";

  const LOOKUP_DELAY = 350;
  const KNOCK_RULES = ["knock", "knock_restricted"];
  const INVITE_RULES = ["invite", "private"];

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  let step: Step = $state("start");
  let template: Template = $state.raw(OWN);
  let activeSession: Session | null = $state.raw(null);
  let roomMap: Record<string, RoomSummary> = $state.raw({});
  let profile: Profile | null = $state.raw(null);

  $effect(() => session.subscribe((value) => (activeSession = value)));
  $effect(() => rooms.subscribe((value) => (roomMap = value)));
  $effect(() => ownProfile.subscribe((value) => (profile = value)));

  let spaceName = $state("");
  let nameTouched = $state(false);
  let icon: Blob | null = $state.raw(null);
  let original: File | null = $state.raw(null);
  let audience: SpaceAudience | undefined = $state();
  let creating = $state(false);
  let createError = $state(false);

  const defaultName = $derived(
    text("create", "default_name").replace("{name}", profile?.displayName ?? activeSession?.userId.slice(1, activeSession.userId.indexOf(":")) ?? ""),
  );
  const effectiveName = $derived(nameTouched ? spaceName : defaultName);

  const pick = (choice: Template) => {
    template = choice;
    go("audience");
  };

  const choose = (value?: SpaceAudience) => {
    audience = value;
    go("create");
  };

  const create = async (event: SubmitEvent) => {
    event.preventDefault();
    const name = effectiveName.trim();
    if (!activeSession || !name || creating) return;
    creating = true;
    createError = false;
    try {
      const avatarUrl = icon ? await uploadBytes(activeSession, icon, icon.type, original?.name.replace(/\.[^.]+$/, "") + "." + (icon.type.split("/")[1] ?? "png")) : undefined;
      const spaceId = await createSpace(activeSession, { name, avatarUrl, rooms: template.rooms, audience });
      controller = new AbortController();
      await waitForRoom(spaceId, controller.signal);
      finish(spaceId);
    } catch {
      if (controller?.signal.aborted) return;
      createError = true;
      creating = false;
    }
  };

  let value = $state("");
  let link: RoomLink | null = $state.raw(null);
  let resolved: ResolvedLink | null = $state.raw(null);
  let status: Status = $state("idle");
  let error: MembershipError | null = $state(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lookup = 0;
  let controller: AbortController | undefined;

  const preview = $derived(resolved?.preview);
  const joined = $derived(!!resolved && roomMap[resolved.roomId]?.membership === "join");
  const knock = $derived(!!preview?.joinRule && KNOCK_RULES.includes(preview.joinRule));
  const inviteOnly = $derived(!!preview?.joinRule && INVITE_RULES.includes(preview.joinRule));
  const invalid = $derived(!!value.trim() && !link);
  const busy = $derived(status === "joining" || status === "waiting");

  const previewItems = (): MenuItem[] =>
    resolved
      ? [
          joined
            ? { id: "preview-open", label: text("join", "open"), icon: MENU_ICONS.open, run: () => join() }
            : { id: "preview-join", label: text("join", knock ? "knock" : preview?.isSpace ? "join_space" : "join"), icon: MENU_ICONS.add, disabled: busy, run: () => join() },
          { id: "preview-link", label: getLocalisedText(undefined, "room_menu", "copy_link") as string, icon: MENU_ICONS.link, separated: true, run: () => copied(toMatrixTo(preview?.alias ?? resolved!.roomId, resolved!.via ?? []), "link_copied", "link") },
          { id: "preview-id", label: getLocalisedText(undefined, "room_menu", "copy_id") as string, icon: MENU_ICONS.id, run: () => copied(resolved!.roomId, "id_copied", "id") },
          ...(preview?.topic ? [{ id: "preview-topic", label: entityText("copy_topic"), icon: MENU_ICONS.copy, run: () => copied(preview!.topic!) }] : []),
        ]
      : [];

  const memberLabel = (count: number) =>
    count === 1 ? text("join", "member") : text("join", "members").replace("{count}", count.toLocaleString());

  const look = async (target: RoomLink, id: number) => {
    if (!activeSession) return;
    try {
      const result = await resolveLink(activeSession, target);
      if (id !== lookup) return;
      resolved = result;
      status = "ready";
    } catch (failure) {
      if (id !== lookup) return;
      error = describeMembershipError(failure);
      status = "idle";
    }
  };

  const oninput = (event: Event & { currentTarget: HTMLInputElement }) => {
    value = event.currentTarget.value;
    clearTimeout(timer);
    const id = ++lookup;
    link = parseRoomLink(value);
    resolved = null;
    error = null;
    status = link ? "looking" : "idle";
    if (link) timer = setTimeout(() => look(link!, id), LOOKUP_DELAY);
  };

  const finish = (roomId: string) => {
    openJoined(roomId);
    dismiss();
  };

  const join = async () => {
    if (!activeSession || !link || !resolved || busy) return;
    if (joined) return finish(resolved.roomId);

    status = "joining";
    error = null;
    const target = link.kind === "alias" ? link.target : resolved.roomId;

    try {
      if (knock) {
        await knockRoom(activeSession, target, resolved.via);
        status = "requested";
        return;
      }

      const { room_id } = await joinRoom(activeSession, target, resolved.via);
      status = "waiting";
      controller = new AbortController();
      await waitForRoom(room_id, controller.signal);
      finish(room_id);
    } catch (failure) {
      if (controller?.signal.aborted) return;
      error = describeMembershipError(failure);
      status = "ready";
    }
  };

  let moved = $state(false);

  const exit = dismissible(() => onclose());

  const dismiss = () => {
    clearTimeout(timer);
    exit.close();
  };

  const close = () => {
    controller?.abort();
    dismiss();
  };

  const go = (next: Step) => {
    moved = true;
    step = next;
  };

  const onsubmit = (event: SubmitEvent) => {
    event.preventDefault();
    if (status === "ready") join();
  };

  const actionLabel = $derived(
    joined
      ? text("join", "open")
      : knock
        ? text("join", "knock")
        : preview?.isSpace
          ? text("join", "join_space")
          : text("join", "join"),
  );
</script>


<span class="portal-anchor" hidden></span>
<div class="layer col centre" class:closing={exit.closing} role="presentation" use:portal>
  <button type="button" class="scrim modal-scrim ghost" tabindex="-1" aria-hidden="true" onclick={close}></button>
  <div class="dialog modal-sheet col" onanimationend={exit.onanimationend} inert={exit.closing} role="dialog" aria-modal="true" aria-labelledby="join-title" tabindex="-1" onkeydown={(event) => event.key === "Escape" && close()}>
    <span class="handle" aria-hidden="true"></span>
    <button type="button" class="close ghost press row centre" aria-label={text("join", "close")} onclick={close}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
    </button>

    {#key step}
      <div class="step col" class:enter={moved} class:back={step === "start"}>
        {#if step === "start"}
          <header class="intro col gap-sm">
            <h2 id="join-title" class="xl bold">{text("create", "title")}</h2>
            <p class="sm muted">{text("create", "subtitle")}</p>
          </header>
          <div class="body col gap-sm scroll">
            <button type="button" class="option ghost press row-nw align-centre gap-md" onclick={() => pick(OWN)}>
              <img class="option-icon" src={getEmojiURL(OWN.icon)} alt="" draggable="false" />
              <span class="md bold flex-max strong">{text("create", "own")}</span>
              <svg class="chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" /></svg>
            </button>
            <span class="xs bold faint label section">{text("create", "from_template")}</span>
            {#each TEMPLATES as entry (entry.id)}
              <button type="button" class="option ghost press row-nw align-centre gap-md" onclick={() => pick(entry)}>
                <img class="option-icon" src={getEmojiURL(entry.icon)} alt="" draggable="false" />
                <span class="md bold flex-max strong">{text("create", "templates", entry.id)}</span>
                <svg class="chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" /></svg>
              </button>
            {/each}
          </div>
          <footer class="foot col gap-md centre">
            <span class="md bold strong">{text("create", "have_invite")}</span>
            <button type="button" class="button large wide" onclick={() => go("join")}>{text("create", "join_space")}</button>
          </footer>
        {:else if step === "join"}
          <form class="col flex-max min-0" {onsubmit}>
            <header class="intro col gap-sm">
              <h2 id="join-title" class="xl bold">{text("join", "title")}</h2>
              <p class="sm muted">{text("join", "subtitle")}</p>
            </header>
            <div class="body col gap-md scroll">
              <label class="field col gap-xs">
                <span class="xs bold faint label">{text("join", "label")} <span class="required" aria-hidden="true">*</span></span>
                <span class="input row-nw align-centre" class:invalid>
                  <!-- svelte-ignore a11y_autofocus -->
                  <input
                    class="flex-max min-0"
                    type="text"
                    inputmode="url"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    required
                    autofocus
                    placeholder={text("join", "placeholder")}
                    aria-invalid={invalid}
                    {value}
                    {oninput}
                  />
                  {#if status === "looking"}<span class="spinner faint" aria-label={text("join", "looking")}></span>{/if}
                </span>
                {#if invalid}<span class="xs error-text" aria-live="polite">{text("join", "invalid")}</span>{/if}
              </label>

              {#if resolved}
                <div class="card col gap-sm" use:menu={previewItems}>
                  {#if preview}
                    <div class="row-nw align-centre gap-md">
                      <Avatar name={preview.name ?? preview.alias ?? preview.roomId} url={preview.avatarUrl} size="48px" radius={preview.isSpace ? "30%" : "50%"} />
                      <div class="col min-0 flex-max">
                        <strong class="md truncate strong"><EmojiText text={preview.name ?? preview.alias ?? preview.roomId} /></strong>
                        <span class="xs faint row-nw gap-sm">
                          <span class="kind">{text("join", preview.isSpace ? "space" : "room")}</span>
                          {#if preview.memberCount !== undefined}<span>{memberLabel(preview.memberCount)}</span>{/if}
                        </span>
                      </div>
                    </div>
                    {#if preview.topic}<p class="sm muted topic"><EmojiText text={preview.topic} /></p>{/if}
                    {#if joined}<p class="xs faint">{text("join", "already")}</p>{:else if inviteOnly}<p class="xs faint">{text("join", "invite_only")}</p>{/if}
                  {:else}
                    <p class="sm muted">{text("join", "no_preview")}</p>
                  {/if}
                </div>
              {:else}
                <div class="col gap-xs">
                  <span class="xs bold faint label">{text("join", "examples_title")}</span>
                  <code class="sm example">#skye:example.org</code>
                  <code class="sm example">https://matrix.to/#/#skye:example.org</code>
                  <code class="sm example">!abc123:example.org</code>
                </div>
              {/if}

              {#if error}<p class="sm error-text" role="alert">{text("join", "errors", error)}</p>{/if}
              {#if status === "requested"}<p class="sm muted" role="status">{text("join", "requested")}</p>{/if}
              {#if status === "waiting"}<p class="sm muted" role="status">{text("join", "waiting")}</p>{/if}
            </div>
            <footer class="foot row-nw align-centre gap-sm">
              <button type="button" class="link ghost press md bold" onclick={() => go("start")} disabled={busy}>{text("create", "back")}</button>
              <button type="submit" class="button large primary row-nw align-centre gap-sm" disabled={status !== "ready" && !busy} aria-busy={busy}>
                {#if busy}<span class="spinner" aria-hidden="true"></span>{text("join", "joining")}{:else}{actionLabel}{/if}
              </button>
            </footer>
          </form>
        {:else if step === "audience"}
          <header class="intro col gap-sm">
            <h2 id="join-title" class="xl bold">{text("create", "audience_title")}</h2>
            <p class="sm muted">{text("create", "audience_subtitle")}</p>
          </header>
          <div class="body col gap-sm scroll">
            {#each SPACE_AUDIENCES as entry (entry.id)}
              <button type="button" class="option ghost press row-nw align-centre gap-md" onclick={() => choose(entry.id)}>
                <img class="option-icon" src={getEmojiURL(entry.icon)} alt="" draggable="false" />
                <span class="md bold flex-max strong">{text("create", "audience", entry.id)}</span>
                <svg class="chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" /></svg>
              </button>
            {/each}
            <p class="sm muted centred">{text("create", "skip_before")}<button type="button" class="inline-link ghost press sm bold" onclick={() => choose()}>{text("create", "skip")}</button>{text("create", "skip_after")}</p>
          </div>
          <footer class="foot row-nw align-centre gap-sm">
            <button type="button" class="link ghost press md bold" onclick={() => go("start")}>{text("create", "back")}</button>
          </footer>
        {:else}
          <form class="col flex-max min-0" onsubmit={create}>
            <header class="intro col gap-sm">
              <h2 id="join-title" class="xl bold">{text("create", "customise_title")}</h2>
              <p class="sm muted">{text("create", "customise_subtitle")}</p>
            </header>
            <div class="body col gap-lg scroll">
              <div class="avatar-slot row-nw centre">
                <AvatarPicker disabled={creating} onpick={(blob, file) => ((icon = blob), (original = file))} />
              </div>
              <label class="field col gap-xs">
                <span class="xs bold faint label">{text("create", "name_label")} <span class="required" aria-hidden="true">*</span></span>
                <span class="input row-nw align-centre">
                  <input
                    class="flex-max min-0"
                    type="text"
                    required
                    maxlength="100"
                    autocomplete="off"
                    value={effectiveName}
                    disabled={creating}
                    oninput={(event) => {
                      nameTouched = true;
                      spaceName = event.currentTarget.value;
                    }}
                  />
                </span>
              </label>
              {#if createError}<p class="sm error-text" role="alert">{text("create", "failed")}</p>{/if}
            </div>
            <footer class="foot row-nw align-centre gap-sm">
              <button type="button" class="link ghost press md bold" onclick={() => go("audience")} disabled={creating}>{text("create", "back")}</button>
              <button type="submit" class="button large primary row-nw align-centre gap-sm" disabled={!effectiveName.trim() || creating} aria-busy={creating}>
                {#if creating}<span class="spinner" aria-hidden="true"></span>{text("create", "creating")}{:else}{text("create", "create")}{/if}
              </button>
            </footer>
          </form>
        {/if}
      </div>
    {/key}
  </div>
</div>
<span class="portal-anchor" hidden></span>

<style>
  .layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    padding: var(--azure-spacing-lg);
  }

  .scrim {
    position: absolute;
    inset: 0;
    cursor: default;
    background-color: var(--colours-scrim);
    backdrop-filter: blur(4px);
  }

  .dialog {
    position: relative;
    width: min(100%, 460px);
    max-height: 100%;
    padding: var(--azure-spacing-xl);
    gap: var(--azure-spacing-lg);
    border-radius: var(--azure-radius-lg);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-foreground);
    box-shadow: 0 24px 64px -16px black;
    outline: none;
    overflow: hidden;
  }

  .handle {
    display: none;
  }

  h2,
  p {
    margin: 0;
  }

  h2,
  .strong {
    color: var(--colours-text-strong);
  }

  .close {
    width: 32px;
    height: 32px;
    flex: none;
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-faint);
  }

  .close:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .tabs {
    border-bottom: 1px solid var(--colours-outline-hairline);
  }

  .tab {
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    color: var(--colours-text-faint);
    border-bottom: 2px solid transparent;
  }

  .tab[aria-selected="true"] {
    color: var(--colours-text-strong);
    border-bottom-color: var(--colours-accent);
  }

  .label {
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .input {
    gap: var(--azure-spacing-sm);
    padding: 0 var(--azure-spacing-md);
    min-height: 44px;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-background);
    transition: border-color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .input.invalid {
    border-color: color-mix(in oklab, var(--colours-danger) 60%, transparent);
  }

  input {
    font: inherit;
    font-size: max(16px, var(--text-md));
    color: var(--colours-text-strong);
    background: none;
    border: none;
    outline: none;
    padding: var(--azure-spacing-sm) 0;
  }

  .error-text {
    color: var(--colours-danger);
  }

  .card {
    padding: var(--azure-spacing-lg);
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-background);
    animation: rise var(--azure-duration-md) var(--azure-ease-out);
  }

  .kind {
    color: var(--colours-accent);
    font-weight: 600;
  }

  .topic {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  .actions {
    justify-content: flex-end;
  }

  .spinner {
    width: 14px;
    height: 14px;
    flex: none;
    border-radius: 50%;
    border: 2px solid currentColor;
    border-right-color: transparent;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinner {
      animation-duration: 3s;
    }
  }

  @media (max-width: 767px) {
    .layer {
      justify-content: flex-end;
      padding: 0;
    }

    .dialog {
      width: 100%;
      max-height: 90dvh;
      padding: var(--azure-spacing-sm) var(--azure-spacing-lg) calc(var(--azure-spacing-xl) + env(safe-area-inset-bottom));
      border-radius: var(--azure-radius-lg) var(--azure-radius-lg) 0 0;
    }

    .handle {
      display: block;
      width: 36px;
      height: 4px;
      margin: 0 auto;
      border-radius: var(--azure-radius-pill);
      background-color: var(--colours-outline-strong);
    }

    .close {
      min-height: var(--azure-touch);
      min-width: var(--azure-touch);
    }
  }

  .close {
    position: absolute;
    top: var(--azure-spacing-md);
    right: var(--azure-spacing-md);
    z-index: 1;
  }

  .step {
    flex: 1;
    min-height: 0;
    gap: var(--azure-spacing-lg);
  }

  .step.enter {
    animation: step-in var(--azure-duration-md) var(--azure-ease-out);
  }

  .step.enter.back {
    animation-name: step-back;
  }

  .step form {
    gap: var(--azure-spacing-lg);
  }

  .intro {
    text-align: center;
    padding: var(--azure-spacing-xs) var(--azure-spacing-xl) 0;
  }

  .intro p {
    line-height: 1.55;
    text-wrap: balance;
  }

  .scroll {
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .section {
    margin-top: var(--azure-spacing-sm);
  }

  .option {
    width: 100%;
    padding: var(--azure-spacing-sm) var(--azure-spacing-md);
    min-height: 56px;
    text-align: left;
    border-radius: var(--azure-radius-md);
    border: 1px solid var(--colours-outline-hairline);
    background-color: var(--colours-background);
  }

  .option:hover {
    background-color: var(--colours-surface);
  }

  .option.press:active {
    transform: scale(var(--press, 0.99));
    background-color: var(--colours-surface-pressed);
  }

  .option:hover .chevron {
    color: var(--colours-text-muted);
  }

  .option-icon {
    width: 32px;
    height: 32px;
    flex: none;
  }

  .chevron {
    flex: none;
    opacity: 0.6;
    color: var(--colours-text-faint);
    transition: color var(--azure-duration-fast) var(--azure-ease-out);
  }

  .foot {
    margin: 0 calc(var(--azure-spacing-xl) * -1) calc(var(--azure-spacing-xl) * -1);
    padding: var(--azure-spacing-lg) var(--azure-spacing-xl);
    background-color: var(--colours-background);
    border-top: 1px solid var(--colours-outline-hairline);
  }

  .foot.row-nw {
    justify-content: space-between;
  }

  .wide {
    width: 100%;
  }

  .link,
  .inline-link {
    color: var(--colours-text-faint);
    padding: 0;
  }

  .link:hover {
    color: var(--colours-text);
  }

  .link:hover,
  .inline-link:hover {
    text-decoration: underline;
  }

  .inline-link {
    display: inline;
    color: var(--colours-accent);
  }

  .centred {
    text-align: center;
  }

  .required {
    color: var(--colours-danger);
  }

  .example {
    color: var(--colours-text);
    overflow-wrap: anywhere;
  }

  @keyframes step-in {
    from {
      opacity: 0;
      transform: translateX(24px);
    }
  }

  @keyframes step-back {
    from {
      opacity: 0;
      transform: translateX(-24px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .step.enter {
      animation-name: enter-fade;
    }
  }

  @media (max-width: 767px) {
    .foot {
      margin: 0 calc(var(--azure-spacing-lg) * -1) calc((var(--azure-spacing-xl) + env(safe-area-inset-bottom)) * -1);
      padding: var(--azure-spacing-lg) var(--azure-spacing-lg) calc(var(--azure-spacing-lg) + env(safe-area-inset-bottom));
    }
  }
</style>
