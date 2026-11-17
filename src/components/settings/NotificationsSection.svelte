<script lang="ts">
  import { onMount } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { notifyPrefs, saveNotifyPrefs, type NotifyPrefs } from "../../scripts/stores/settings";
  import { toastKey } from "../../scripts/stores/toast";
  import { enableNotifications } from "../../scripts/stores/unread";
  import Toggle from "../ui/Toggle.svelte";
  import { addKeyword, keywords, pushRules, removeKeyword, ruleOn, setRuleOn, type PushKind, type RuleSet } from "../../scripts/stores/pushrules";
  import { menu } from "../../scripts/misc/entitymenu.svelte";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { copied } from "../../scripts/stores/toast";
  import type { MenuItem } from "../app/MessageMenu.svelte";

  const text = (...path: string[]) => getLocalisedText(undefined, "settings", "notify", ...path) as string;

  let prefs = $state.raw<NotifyPrefs>({ directs: true, mentionsOnly: true });
  let permission = $state<NotificationPermission | "unsupported">("default");
  let asking = $state(false);

  $effect(() => notifyPrefs.subscribe((value) => (prefs = value)));

  const readPermission = () => (permission = "Notification" in window ? Notification.permission : "unsupported");

  onMount(readPermission);

  const enable = async () => {
    asking = true;
    await enableNotifications();
    asking = false;
    readPermission();
  };

  const RULES: { key: string; ids: [PushKind, string][] }[] = [
    { key: "rule_master", ids: [["override", ".m.rule.master"]] },
    { key: "rule_mentions", ids: [["override", ".m.rule.is_user_mention"], ["override", ".m.rule.contains_display_name"], ["content", ".m.rule.contains_user_name"]] },
    { key: "rule_room", ids: [["override", ".m.rule.is_room_mention"], ["override", ".m.rule.roomnotif"]] },
    { key: "rule_directs", ids: [["underride", ".m.rule.room_one_to_one"], ["underride", ".m.rule.encrypted_room_one_to_one"]] },
    { key: "rule_group", ids: [["underride", ".m.rule.message"], ["underride", ".m.rule.encrypted"]] },
  ];

  let rules = $state.raw<RuleSet>({});
  let draft = $state("");

  $effect(() => pushRules.subscribe((value) => (rules = value)));

  const present = (ids: [PushKind, string][]) => ids.filter(([kind, id]) => (rules[kind] ?? []).some((rule) => rule.rule_id === id));
  const isOn = (ids: [PushKind, string][]) => present(ids).some(([kind, id]) => ruleOn(rules, kind, id));
  const flip = (ids: [PushKind, string][], on: boolean) => Promise.all(present(ids).map(([kind, id]) => setRuleOn(kind, id, on)));
  const masterOff = $derived(isOn(RULES[0].ids));

  const ruleItems = (ids: [PushKind, string][]): MenuItem[] => [
    { id: "rule-on", label: text("turn_on"), icon: MENU_ICONS.read, selected: isOn(ids), run: () => flip(ids, true) },
    { id: "rule-off", label: text("turn_off"), icon: MENU_ICONS.mute, selected: !isOn(ids), run: () => flip(ids, false) },
  ];

  const keywordItems = (ruleId: string, pattern: string): MenuItem[] => [
    { id: "keyword-copy", label: text("keyword_copy"), icon: MENU_ICONS.copy, run: () => copied(pattern) },
    { id: "keyword-remove", label: text("keyword_remove"), icon: MENU_ICONS.delete, danger: true, separated: true, run: () => removeKeyword(ruleId) },
  ];

  const addItems = (): MenuItem[] => [{ id: "keyword-add", label: text("keyword_add"), icon: MENU_ICONS.add, disabled: !draft.trim(), run: submit }];

  const submit = () => {
    const word = draft.trim();
    draft = "";
    return word && addKeyword(word);
  };

  const bezier = (a: number, b: number) => (s: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  const x = bezier(0.32, 0);
  const y = bezier(0.72, 1);
  const curve = (t: number) => {
    const s = Array.from({ length: 24 }).reduce<[number, number]>(([lo, hi]) => (x((lo + hi) / 2) < t ? [(lo + hi) / 2, hi] : [lo, (lo + hi) / 2]), [0, 1]);
    return y((s[0] + s[1]) / 2);
  };

  const reveal = (node: HTMLElement) => ({
    duration: 320,
    easing: curve,
    css: (t: number) => `opacity: ${t}; transform: scale(${0.96 + t * 0.04}); height: ${t * node.offsetHeight}px; margin-block-end: ${(t - 1) * 8}px`,
  });

  const update = (next: Partial<NotifyPrefs>) =>
    saveNotifyPrefs({ ...prefs, ...next }).then(
      () => toastKey("settings_saved", { icon: "save", tone: "success" }),
      () => toastKey("settings_failed", { tone: "danger" }),
    );
</script>

<section class="set-section" data-part="browser">
  <h3 class="set-heading">{text("heading_push")}</h3>
  <div class="set-row">
    <div class="col gap-xs min-0">
      <span class="set-title">{text("desktop")}</span>
      <p class="set-hint">{text("desktop_hint")}</p>
      <p class="state xs bold" data-state={permission}>{text(permission)}</p>
    </div>
    {#if permission === "default"}
      <button type="button" class="set-button primary ghost press" disabled={asking} onclick={enable}>{getLocalisedText(undefined, "notifications", "enable")}</button>
    {:else}
      <Toggle checked={permission === "granted"} disabled label={text("desktop")} />
    {/if}
  </div>
</section>

<section class="set-section" data-part="synced">
  <h3 class="set-heading">{text("heading_account")}</h3>
  <div class="set-rows">
    <div class="set-row">
      <div class="col gap-xs min-0">
        <span class="set-title">{text("directs")}</span>
        <p class="set-hint">{text("directs_hint")}</p>
      </div>
      <Toggle checked={prefs.directs} label={text("directs")} onchange={(value) => update({ directs: value })} />
    </div>
    <div class="set-row">
      <span class="set-title">{text("rooms")}</span>
      <div class="choice row-nw" role="radiogroup" aria-label={text("rooms")} style:--index={prefs.mentionsOnly ? 0 : 1}>
        <span class="thumb" aria-hidden="true"></span>
        {#each [true, false] as mentions (mentions)}
          <button type="button" class="choice-option ghost press sm bold" role="radio" aria-checked={prefs.mentionsOnly === mentions} onclick={() => prefs.mentionsOnly !== mentions && update({ mentionsOnly: mentions })}>
            {text(mentions ? "mentions" : "all")}
          </button>
        {/each}
      </div>
    </div>
  </div>
  <p class="set-hint">{text("synced")}</p>
</section>

<section class="set-section" data-part="rules">
  <h3 class="set-heading">{text("heading_rules")}</h3>
  <div class="set-rows">
    {#each RULES as row, index (row.key)}
      <div class="set-row rule" class:dimmed={index > 0 && masterOff} use:menu={() => ruleItems(row.ids)}>
        <div class="col gap-xs min-0">
          <span class="set-title">{text(row.key)}</span>
          <p class="set-hint">{text(`${row.key}_hint`)}</p>
        </div>
        <Toggle checked={isOn(row.ids)} disabled={!present(row.ids).length} label={text(row.key)} onchange={(value) => flip(row.ids, value)} />
      </div>
    {/each}
  </div>
  <p class="set-hint">{text("rules_hint")}</p>
</section>

<section class="set-section" data-part="keywords">
  <h3 class="set-heading">{text("heading_keywords")}</h3>
  <p class="set-hint">{text("keywords_hint")}</p>
  <form class="row-nw gap-sm" onsubmit={(event) => (event.preventDefault(), submit())}>
    <span class="set-input flex-max min-0" use:menu={addItems}><input bind:value={draft} maxlength="100" aria-label={text("keyword_label")} placeholder={text("keyword_placeholder")} /></span>
    <button type="submit" class="set-button primary ghost press" disabled={!draft.trim()} use:menu={addItems}>{text("keyword_add")}</button>
  </form>
  <ul class="set-rows keywords">
    {#each keywords(rules) as rule (rule.rule_id)}
      <li class="set-row" use:menu={() => keywordItems(rule.rule_id, rule.pattern ?? "")} transition:reveal>
        <span class="set-title truncate">{rule.pattern}</span>
        <button type="button" class="set-button ghost press" use:menu={() => keywordItems(rule.rule_id, rule.pattern ?? "")} onclick={() => removeKeyword(rule.rule_id)}>{text("keyword_remove")}</button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .rule {
    transition: opacity var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .rule.dimmed {
    opacity: 0.5;
  }

  .keywords {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .keywords:empty {
    display: none;
  }

  .state {
    margin: 0;
    color: var(--colours-text-faint);
  }

  .state[data-state="granted"] {
    color: var(--colours-success);
  }

  .state[data-state="denied"] {
    color: var(--colours-danger);
  }

  .choice {
    position: relative;
    display: grid;
    grid-template-columns: 1fr 1fr;
    padding: 3px;
    border-radius: 8px;
    border: 1px solid var(--colours-outline-hairline);
  }

  .thumb {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc(50% - 3px);
    border-radius: 6px;
    background-color: var(--colours-surface-raised);
    box-shadow: inset 0 0 0 1px var(--colours-outline-hairline);
    transform: translateX(calc(var(--index) * 100%));
    transition: transform var(--azure-duration-slow) cubic-bezier(0.32, 0.72, 0, 1);
  }

  .choice-option {
    position: relative;
    min-height: 32px;
    padding: 0 var(--azure-spacing-md);
    color: var(--colours-text-muted);
    white-space: nowrap;
  }

  .choice-option[aria-checked="true"] {
    color: var(--colours-text-strong);
  }

  @media (max-width: 767px) {
    .choice-option {
      min-height: var(--azure-touch);
    }
  }
</style>
