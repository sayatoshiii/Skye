<script lang="ts">
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { answerCall, declineCall } from "../../scripts/stores/calls";
  import { toEntity } from "../../scripts/stores/entities";
  import { rooms, session } from "../../scripts/stores/matrix";
  import { openJoined } from "../../scripts/stores/navigation.svelte";
  import { incomingCall } from "../../scripts/stores/voice";
  import Icon from "../settings/Icon.svelte";
  import { SETTINGS_ICONS } from "../settings/icons";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import type { MenuItem } from "./MessageMenu.svelte";

  const text = (...path: string[]) => getLocalisedText(undefined, "voice", ...path) as string;

  let last = $state.raw($incomingCall);
  $effect(() => void ($incomingCall && (last = $incomingCall)));

  const room = $derived(last && $rooms[last.roomId] ? toEntity($rooms[last.roomId], $session?.userId) : null);
  const caller = $derived(last ? $rooms[last.roomId]?.members[last.callerId] : undefined);
  const name = $derived(caller?.displayName || last?.callerId.slice(1).split(":")[0] || "");
  const direct = $derived(!!room?.isDirect);

  const items = (): MenuItem[] => [
    { id: "call-accept", label: text("accept"), icon: SETTINGS_ICONS.call, run: answerCall },
    { id: "call-open", label: text("open_room"), icon: MENU_ICONS.jump, run: () => last && openJoined(last.roomId) },
    { id: "call-decline", label: text("decline"), icon: SETTINGS_ICONS.hangup, danger: true, separated: true, run: declineCall },
  ];
</script>

<div class="incoming" class:open={!!$incomingCall} inert={!$incomingCall} role="alertdialog" aria-label={text("incoming")} use:menu={items}>
  <span class="pulse"><Avatar {name} url={caller?.avatarUrl ?? room?.avatar} size="44px" radius="50%" /></span>
  <div class="col min-0 flex-max">
    <span class="xs muted">{text("incoming")}</span>
    <span class="md bold truncate"><EmojiText text={direct ? name : text("incoming_voice").replace("{name}", name)} /></span>
    {#if !direct && room}<span class="xs muted truncate"><EmojiText text={room.name} /></span>{/if}
  </div>
  <button type="button" class="ghost round answer decline press" aria-label={text("decline")} onclick={declineCall} use:menu={() => [items()[2]]}><Icon name="hangup" size={20} /></button>
  <button type="button" class="ghost round answer accept press" aria-label={text("accept")} onclick={answerCall} use:menu={() => [items()[0]]}><Icon name="call" size={20} /></button>
</div>

<style>
  .incoming {
    position: fixed;
    top: 16px;
    left: 50%;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 12px;
    width: min(380px, calc(100vw - 32px));
    padding: 12px 14px;
    border-radius: 22px;
    background: color-mix(in oklab, var(--colours-foreground) 85%, black);
    border: 1px solid var(--colours-outline-hairline);
    box-shadow: 0 18px 48px rgb(0 0 0 / 0.45);
    opacity: 0;
    translate: -50% -24px;
    scale: 0.94;
    pointer-events: none;
    transition:
      opacity 420ms cubic-bezier(0.32, 0.72, 0, 1),
      translate 420ms cubic-bezier(0.32, 0.72, 0, 1),
      scale 420ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .incoming.open {
    opacity: 1;
    translate: -50% 0;
    scale: 1;
    pointer-events: auto;
  }

  .pulse {
    display: grid;
    border-radius: 50%;
    animation: ring 1.6s cubic-bezier(0.32, 0.72, 0, 1) infinite;
  }

  .answer {
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    flex: none;
    color: white;
    transition: scale 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .answer:hover {
    scale: 1.06;
  }

  .accept {
    background: var(--colours-success);
  }

  .decline {
    background: var(--colours-danger);
  }

  @keyframes ring {
    from {
      box-shadow: 0 0 0 0 color-mix(in oklab, var(--colours-success) 60%, transparent);
    }
    to {
      box-shadow: 0 0 0 12px transparent;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .pulse {
      animation: none;
    }
  }
</style>
