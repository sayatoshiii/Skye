<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { closeRoom, type ClosureStep } from "../../scripts/matrix/utilities/creation";
  import { describeMembershipError, forgetRoom, leaveRoom, type MembershipError } from "../../scripts/matrix/utilities/membership";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { closureOf } from "../../scripts/menus/room";
  import { announceSync, disableSync, enableSync, hasBackup } from "../../scripts/matrix/utilities/rolesync";
  import { prompt } from "../../scripts/menus/prompts.svelte";
  import { joinedRoomsOf } from "../../scripts/menus/space";
  import { toEntity } from "../../scripts/stores/entities";
  import { rooms, session, spaces } from "../../scripts/stores/matrix";
  import { navigateAwayFrom } from "../../scripts/stores/navigation.svelte";
  import { toast } from "../../scripts/stores/toast";
  import { SETTINGS_ICONS } from "../settings/icons";
  import Button from "../ui/Button.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import Icon from "../ui/Icon.svelte";

  const text = (...path: string[]) => getLocalisedText(undefined, ...path) as string;

  const STEPS: { id: ClosureStep; icon: string }[] = [
    { id: "unlist", icon: MENU_ICONS.hide },
    { id: "lock", icon: SETTINGS_ICONS.privacy },
    { id: "remove", icon: MENU_ICONS.kick },
    { id: "leave", icon: MENU_ICONS.leave },
  ];

  const CAVEATS = [
    { id: "servers", icon: SETTINGS_ICONS.globe },
    { id: "history", icon: MENU_ICONS.message },
    { id: "ranks", icon: SETTINGS_ICONS.shield },
    { id: "invites", icon: MENU_ICONS.link },
  ];

  const SYNC_STEPS = [
    { id: "copy", icon: SETTINGS_ICONS.shield },
    { id: "match", icon: MENU_ICONS.profile },
    { id: "follow", icon: MENU_ICONS.retry },
  ];

  const SYNC_CAVEATS = [
    { id: "permissions", icon: SETTINGS_ICONS.privacy },
    { id: "skipped", icon: MENU_ICONS.hide },
    { id: "clients", icon: SETTINGS_ICONS.globe },
    { id: "undo", icon: MENU_ICONS.retry },
  ];

  let dialog: ConfirmDialog | undefined = $state();
  let busy = $state(false);
  let step = $state<ClosureStep | null>(null);
  let error = $state<MembershipError | null>(null);
  let failed = $state(false);
  let missed = $state(0);
  let forget = $state(false);
  let progress = $state<{ done: number; total: number } | null>(null);

  const current = $derived(prompt.current);
  const room = $derived(current ? $rooms[current.id] : undefined);
  const name = $derived(room ? toEntity(room, $session?.userId).name : "");
  const tree = $derived(current?.kind === "leave-space" ? $spaces.find((entry) => entry.space.roomId === current.id) : undefined);
  const nested = $derived(tree ? joinedRoomsOf(tree) : []);
  const stuck = $derived(current?.kind === "delete" ? closureOf(current.id).stuck : 0);

  const reset = () => ((prompt.current = null), (busy = false), (step = null), (error = null), (failed = false), (forget = false), (progress = null), (missed = 0));

  const leave = async (roomId: string) => {
    if (!$session || busy) return;
    busy = true;
    error = null;
    try {
      await leaveRoom($session, roomId);
      if (forget) await forgetRoom($session, roomId).catch(() => undefined);
      navigateAwayFrom([roomId]);
      dialog?.dismiss();
    } catch (reason) {
      error = describeMembershipError(reason);
    } finally {
      busy = false;
    }
  };

  const remove = async (roomId: string) => {
    if (!$session || busy) return;
    busy = true;
    failed = false;
    try {
      const { parents, members, stuck: blocked } = closureOf(roomId);
      const skipped = await closeRoom($session, { roomId, parents, members, reason: text("room_menu", "delete_reason") }, (next) => (step = next));
      const left = skipped + blocked;
      navigateAwayFrom([roomId]);
      toast(left ? text("room_menu", "deleted_partial").replace("{count}", String(left)) : text("room_menu", "deleted"), { icon: "trash", tone: left ? "neutral" : "danger" });
      dialog?.dismiss();
    } catch {
      failed = true;
    } finally {
      busy = false;
      step = null;
    }
  };

  const leaveSpace = async (spaceId: string, withRooms: boolean) => {
    if (!$session || progress) return;
    const ids = withRooms ? [...nested, spaceId] : [spaceId];
    const left: string[] = [];
    progress = { done: 0, total: ids.length };
    for (const roomId of ids) {
      await leaveRoom($session, roomId).then(() => left.push(roomId), () => undefined);
      progress.done += 1;
    }
    navigateAwayFrom(left);
    progress = null;
    missed = ids.length - left.length;
    if (!missed) dialog?.dismiss();
  };

  const startSync = async (spaceId: string) => {
    const space = $rooms[spaceId];
    if (!$session || !space || busy) return;
    busy = true;
    failed = false;
    try {
      prompt.busy = true;
      announceSync(await enableSync($session, $rooms, space));
      dialog?.dismiss();
    } catch {
      failed = true;
    } finally {
      busy = false;
      prompt.busy = false;
    }
  };

  const stopSync = async (spaceId: string, restore: boolean) => {
    const space = $rooms[spaceId];
    if (!$session || !space || busy) return;
    busy = true;
    failed = false;
    try {
      prompt.busy = true;
      const outcome = await disableSync($session, $rooms, space, restore);
      restore ? announceSync(outcome, true) : toast(text("role_sync", "stopped"), { icon: "check", tone: "success" });
      dialog?.dismiss();
    } catch {
      failed = true;
    } finally {
      busy = false;
      prompt.busy = false;
    }
  };

  const leaveAll = (count: number) => (count === 1 ? text("space_menu", "leave_all_one") : text("space_menu", "leave_all").replace("{count}", count.toLocaleString()));
</script>

{#snippet rows(path: string[], quiet: boolean, entries: { id: string; icon: string }[])}
  {#each entries as entry (entry.id)}
    <div class="closure-row row-nw align-start gap-md" class:active={step === entry.id}>
      <span class="closure-icon row-nw centre" class:quiet><Icon d={entry.icon} size={22} /></span>
      <span class="col gap-xs">
        <span class="md bold closure-title">{text(...path, entry.id, "title")}</span>
        <span class="sm muted">{text(...path, entry.id, "body")}</span>
      </span>
    </div>
  {/each}
{/snippet}

{#snippet explainer(path: string[], prefix: string, steps: { id: string; icon: string }[], caveats: { id: string; icon: string }[])}
  <div class="closure-grid">
    <section class="closure">
      <span class="closure-heading xs bold">{text(...path, `${prefix}steps_title`)}</span>
      {@render rows([...path, `${prefix}steps`], false, steps)}
    </section>
    <section class="closure caveats">
      <span class="closure-heading xs bold">{text(...path, `${prefix}caveats_title`)}</span>
      {@render rows([...path, `${prefix}caveats`], true, caveats)}
    </section>
  </div>
{/snippet}

{#if current?.kind === "leave"}
  {@const roomId = current.id}
  <ConfirmDialog
    bind:this={dialog}
    title={text("room_menu", "leave_title").replace("{name}", name)}
    body={text("room_menu", "leave_body")}
    cancelLabel={text("room_menu", "cancel")}
    confirmLabel={text("room_menu", busy ? "leaving" : "leave")}
    {busy}
    onconfirm={() => leave(roomId)}
    onclose={reset}
  >
    {#if room?.isDirect}
      <label class="forget row-nw align-centre gap-sm sm">
        <input type="checkbox" bind:checked={forget} disabled={busy} />
        <span>{text("room_menu", "forget")}</span>
      </label>
    {/if}
    {#if error}<p class="problem sm" role="alert">{text("room_menu", "errors", error)}</p>{/if}
  </ConfirmDialog>
{:else if current?.kind === "delete"}
  {@const roomId = current.id}
  <ConfirmDialog
    bind:this={dialog}
    title={text("room_menu", "delete_title").replace("{name}", name)}
    body={text("room_menu", "delete_body")}
    cancelLabel={text("room_menu", "cancel")}
    confirmLabel={step ? text("room_menu", "delete_progress", step) : text("room_menu", "delete")}
    {busy}
    onconfirm={() => remove(roomId)}
    onclose={reset}
  >
    {@render explainer(["room_menu"], "delete_", STEPS, CAVEATS)}
    {#if stuck}<p class="warning sm">{text("room_menu", "delete_skipped").replace("{count}", String(stuck))}</p>{/if}
    {#if failed}<p class="problem sm" role="alert">{text("room_menu", "delete_failed")}</p>{/if}
  </ConfirmDialog>
{:else if current?.kind === "sync-roles"}
  {@const spaceId = current.id}
  <ConfirmDialog
    bind:this={dialog}
    title={text("role_sync", "title").replace("{name}", name)}
    body={text("role_sync", "body")}
    cancelLabel={text("room_menu", "cancel")}
    confirmLabel={text("role_sync", busy ? "syncing" : "confirm")}
    tone="primary"
    {busy}
    onconfirm={() => startSync(spaceId)}
    onclose={reset}
  >
    {@render explainer(["role_sync"], "", SYNC_STEPS, SYNC_CAVEATS)}
    {#if failed}<p class="problem sm" role="alert">{text("role_sync", "failed")}</p>{/if}
  </ConfirmDialog>
{:else if current?.kind === "unsync-roles"}
  {@const spaceId = current.id}
  <ConfirmDialog bind:this={dialog} title={text("role_sync", "stop_title")} body={text("role_sync", hasBackup(room) ? "stop_body" : "stop_body_plain")} cancelLabel={text("room_menu", "cancel")} {busy} onclose={reset}>
    {#if failed}<p class="problem sm" role="alert">{text("role_sync", "failed")}</p>{/if}
    {#snippet actions()}
      <Button variant={hasBackup(room) ? "outline" : "primary"} disabled={busy} onclick={() => stopSync(spaceId, false)}>{text("role_sync", "keep")}</Button>
      {#if hasBackup(room)}<Button variant="link" outlined disabled={busy} autofocus onclick={() => stopSync(spaceId, true)}>{text("role_sync", "restore")}</Button>{/if}
    {/snippet}
  </ConfirmDialog>
{:else if current?.kind === "leave-space" && tree}
  {@const spaceId = current.id}
  <ConfirmDialog
    bind:this={dialog}
    title={text("space_menu", "leave_title").replace("{name}", toEntity(tree.space, $session?.userId).name)}
    body={text("space_menu", "leave_body")}
    cancelLabel={text("space_menu", "cancel")}
    busy={!!progress}
    onclose={reset}
  >
    {#if progress}
      <p class="sm muted" role="status">{text("space_menu", "progress").replace("{done}", String(progress.done)).replace("{total}", String(progress.total))}</p>
      <progress class="meter" value={progress.done} max={progress.total}></progress>
    {:else if missed}
      <p class="problem sm" role="alert">{text("space_menu", "failed").replace("{count}", String(missed))}</p>
    {/if}
    {#snippet actions()}
      {#if nested.length}
        <Button variant="danger" icon={MENU_ICONS.thread} disabled={!!progress} onclick={() => leaveSpace(spaceId, true)}>{leaveAll(nested.length)}</Button>
      {/if}
      <Button variant="danger" icon={MENU_ICONS.leave} disabled={!!progress} onclick={() => leaveSpace(spaceId, false)}>{text("space_menu", "leave_only")}</Button>
    {/snippet}
  </ConfirmDialog>
{/if}

<style>
  :global(.confirm-layer .confirm:has(.closure)) {
    width: min(100%, 860px);
    max-height: calc(100dvh - 2 * var(--azure-spacing-lg));
    padding: calc(var(--azure-spacing-xl) + 8px);
    overflow-y: auto;
    gap: var(--azure-spacing-lg);
  }

  .closure-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: var(--azure-spacing-lg);
    margin-top: var(--azure-spacing-sm);
  }

  .closure {
    display: grid;
    grid-row: span 5;
    grid-template-rows: subgrid;
    row-gap: var(--azure-spacing-sm);
    align-items: center;
    padding: var(--azure-spacing-lg) var(--azure-spacing-xl);
    border-radius: var(--azure-radius-lg);
    background-color: var(--colours-surface);
  }

  .caveats {
    background-color: color-mix(in oklab, var(--colours-warning) 5%, var(--colours-surface));
  }

  .closure-heading {
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: var(--colours-text-faint);
  }

  .closure-row {
    padding: var(--azure-spacing-sm) 0;
    line-height: 1.45;
  }

  .closure-title {
    color: var(--colours-text-strong);
  }

  .closure-icon {
    flex: none;
    width: 42px;
    height: 42px;
    border-radius: var(--azure-radius-md);
    color: var(--colours-text);
    background-color: var(--colours-surface-hover);
    transition:
      color var(--azure-duration-md) var(--azure-ease-out),
      background-color var(--azure-duration-md) var(--azure-ease-out);
  }

  .closure-icon.quiet {
    color: var(--colours-warning);
    background-color: color-mix(in oklab, var(--colours-warning) 12%, transparent);
  }

  .closure-row.active .closure-icon {
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
  }

  .forget {
    cursor: pointer;
    color: var(--colours-text);
  }

  .forget input {
    width: 16px;
    height: 16px;
    margin: 0;
    accent-color: var(--colours-accent);
  }

  .problem,
  .warning {
    margin: 0;
  }

  .problem {
    color: var(--colours-danger);
  }

  .warning {
    color: var(--colours-warning);
  }

  .meter {
    width: 100%;
    height: 6px;
    accent-color: var(--colours-accent);
  }

  @media (max-width: 767px) {
    .closure-grid {
      grid-template-columns: minmax(0, 1fr);
      row-gap: var(--azure-spacing-lg);
    }

    .closure {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      grid-row: auto;
    }
  }
</style>
