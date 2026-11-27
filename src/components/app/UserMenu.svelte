<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { openDirect, userMenu } from "../../scripts/stores/navigation.svelte";
  import { moderate } from "../../scripts/misc/usermenu";
  import { userActions } from "../../scripts/menus/user";
  import { rooms } from "../../scripts/stores/matrix";
  import { toastKey } from "../../scripts/stores/toast";
  import MessageMenu from "./MessageMenu.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";

  const text = (...path: string[]) => getLocalisedText(undefined, "user_menu", ...path) as string;

  let reason = $state("");
  let busy = $state(false);
  let dialog: ConfirmDialog | undefined = $state();

  const nameOf = (userId: string, roomId?: string) =>
    (roomId && $rooms[roomId]?.members[userId]?.displayName) ||
    Object.values($rooms).map((room) => room.members[userId]?.displayName).find(Boolean) ||
    userId;

  const confirm = async () => {
    const request = userMenu.confirm;
    if (!request || busy) return;
    busy = true;
    try {
      if (request.kind === "direct") await openDirect(request.userId).catch(() => toastKey("direct_failed", { icon: "leave", tone: "danger" }));
      else if (request.roomId) await moderate(request.kind, request.userId, request.roomId, reason);
    } finally {
      busy = false;
      dialog?.dismiss();
    }
  };
</script>

{#if userMenu.request}
  {@const menu = userMenu.request}
  <MessageMenu items={userActions(menu.userId, { roomId: menu.roomId })} x={menu.x} y={menu.y} label={text("actions")} onclose={() => (userMenu.request = null)} />
{/if}

{#if userMenu.confirm}
  {@const request = userMenu.confirm}
  {@const name = nameOf(request.userId, request.roomId)}
  <ConfirmDialog
    bind:this={dialog}
    title={text(`${request.kind}_title`).replace("{name}", name)}
    body={text(`${request.kind}_body`).replace("{name}", name)}
    cancelLabel={text("cancel")}
    confirmLabel={text(`${request.kind}_confirm`)}
    tone={request.kind === "direct" ? "primary" : "danger"}
    {busy}
    onconfirm={confirm}
    onclose={() => ((userMenu.confirm = null), (reason = ""))}
  >
    {#if request.kind !== "direct"}
      <input class="reason-field sm" type="text" maxlength="300" placeholder={text("reason")} aria-label={text("reason")} bind:value={reason} onkeydown={(event) => event.key === "Enter" && confirm()} />
    {/if}
  </ConfirmDialog>
{/if}

<style>
  .reason-field {
    width: 100%;
    height: 38px;
    padding: 0 var(--azure-spacing-md);
    border: 1px solid var(--colours-outline-hairline);
    border-radius: var(--azure-radius-sm);
    color: var(--colours-text-strong);
    background-color: var(--colours-background);
    outline: none;
  }

  .reason-field:focus-visible {
    border-color: var(--colours-accent);
  }
</style>
