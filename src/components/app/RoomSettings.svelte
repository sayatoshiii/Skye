<script lang="ts">
  import ColourPopover from "../ui/ColourPopover.svelte";
  import ConfirmDialog from "../ui/ConfirmDialog.svelte";
  import Avatar from "../ui/Avatar.svelte";
  import EmojiText from "../ui/EmojiText.svelte";
  import Toggle from "../ui/Toggle.svelte";
  import Icon from "../settings/Icon.svelte";
  import { untrack } from "svelte";
  import { getLocalisedText } from "../../scripts/accessibility/language/translation";
  import { menu, openEntityMenu } from "../../scripts/misc/entitymenu.svelte";
  import { dismissible } from "../../scripts/misc/dismiss.svelte";
  import { portal } from "../../scripts/misc/portal";
  import { MENU_ICONS } from "../../scripts/misc/icons";
  import { copied, toastKey } from "../../scripts/stores/toast";
  import { rooms, session } from "../../scripts/stores/matrix";
  import { getPowerLevel } from "../../scripts/matrix/rooms";
  import { uploadImage } from "../../scripts/matrix/utilities/account";
  import {
    DEFAULT_NAMES,
    PERMISSIONS,
    PERMISSION_GROUPS,
    ROLES_EVENT,
    buildRoles,
    grant,
    powerRead,
    readRoles,
    setPowerLevels,
    setRoles,
    type Permission,
    type Role,
    type RoleMeta,
  } from "../../scripts/matrix/utilities/power";
  import type { PowerLevels } from "../../scripts/matrix/types";
  import type { MenuItem } from "./MessageMenu.svelte";

  let colourAnchor: HTMLElement | null = $state(null);
  let { roomId, onclose }: { roomId: string; onclose: () => void } = $props();

  type Tab = "display" | "permissions" | "members";
  type Selection = number | "everyone";

  const TABS: Tab[] = ["display", "permissions", "members"];
  const PALETTE = [
    "#1abc9c", "#2ecc71", "#3498db", "#9b59b6", "#e91e63", "#f1c40f", "#e67e22", "#e74c3c", "#95a5a6", "#607d8b",
    "#11806a", "#1f8b4c", "#206694", "#71368a", "#ad1457", "#c27c0e", "#a84300", "#992d22", "#979c9f", "#546e7a",
  ];

  const text = (...path: string[]) => getLocalisedText(undefined, "room_settings", ...path) as string;
  const fill = (key: string, values: Record<string, string | number>) => Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), text(key));

  const curveX = (s: number) => 0.96 * (1 - s) ** 2 * s + s ** 3;
  const curveDX = (s: number) => 0.96 * (1 - s) * (1 - 3 * s) + 3 * s ** 2;
  const curveY = (s: number) => 2.16 * (1 - s) ** 2 * s + 3 * (1 - s) * s ** 2 + s ** 3;
  const ease = (t: number) => curveY(Array.from({ length: 8 }).reduce<number>((s) => Math.min(1, Math.max(0, s - (curveX(s) - t) / curveDX(s))), t));
  const grow = (_: Element) => ({ duration: 420, easing: ease, css: (t: number) => `grid-template-rows: ${t}fr; opacity: ${t};` });

  const room = $derived($rooms[roomId]);
  const me = $derived($session?.userId ?? "");
  const original = $derived(room?.powerLevels ?? {});
  const originalMeta = $derived(readRoles(room));
  const own = $derived(room ? getPowerLevel(room, me) : 0);
  const editable = $derived(own >= powerRead("m.room.power_levels")(original));
  const metaEditable = $derived(own >= powerRead(ROLES_EVENT)(original));

  let draft: PowerLevels = $state(untrack(() => structuredClone(($rooms[roomId]?.powerLevels ?? {}) as PowerLevels)));
  let meta: RoleMeta[] = $state(untrack(() => structuredClone(readRoles($rooms[roomId]))));
  let editing = $state(false);
  let selected = $state<Selection>("everyone");
  let tab = $state<Tab>("display");
  let query = $state("");
  let permQuery = $state("");
  let memberQuery = $state("");
  let pickQuery = $state("");
  let picking = $state(false);
  let picked = $state<string[]>([]);
  let deleting = $state<Role | null>(null);
  let busy = $state(false);
  let failed = $state(false);
  let demoting = $state(false);
  let uploading = $state(false);
  let levelError = $state(false);
  let picker: HTMLInputElement | undefined = $state();

  const exit = dismissible(() => onclose());

  const base = $derived(draft.users_default ?? 0);
  const joined = $derived(Object.values(room?.members ?? {}).filter((member) => member.membership === "join").map((member) => member.userId));
  const roleName = (level: number) => (DEFAULT_NAMES[level] ? text(DEFAULT_NAMES[level]) : fill("level_name", { level }));
  const roles = $derived(buildRoles(draft, meta, joined, roleName));
  const needle = $derived(query.trim().toLowerCase());
  const shownRoles = $derived(roles.filter((role) => role.name.toLowerCase().includes(needle)));

  const everyone = $derived(selected === "everyone");
  const role = $derived(roles.find((entry) => entry.level === selected));
  const level = $derived(everyone ? base : (role?.level ?? base));
  const tabs = $derived<Tab[]>(everyone ? ["permissions"] : TABS);
  const activeTab = $derived<Tab>(tabs.includes(tab) ? tab : "permissions");
  const roleEditable = $derived(editable && level < own);
  const displayEditable = $derived(metaEditable && !everyone && level <= own);
  const colour = $derived(role?.color);
  const userLevel = (userId: string) => draft.users?.[userId] ?? base;
  const nameOf = (userId: string) => room?.members[userId]?.displayName ?? userId;
  const avatarOf = (userId: string) => room?.members[userId]?.avatarUrl;
  const free = $derived(Array.from({ length: Math.max(0, own - base - 1) }, (_, index) => base + 1 + index).find((value) => !roles.some((entry) => entry.level === value)));
  const canCreate = $derived(editable && metaEditable && free !== undefined);

  const permNeedle = $derived(permQuery.trim().toLowerCase());
  const permGroups = $derived(
    PERMISSION_GROUPS.map((group) => ({
      group,
      items: PERMISSIONS.filter((permission) => permission.group === group && `${text("perm", permission.key, "label")} ${text("perm", permission.key, "hint")}`.toLowerCase().includes(permNeedle)),
    })),
  );
  const permOn = (permission: Permission) => permission.read(draft) <= level;
  const permAllowed = (permission: Permission) => roleEditable && permission.read(draft) <= own;

  const memberNeedle = $derived(memberQuery.trim().toLowerCase());
  const roleMembers = $derived((role?.members ?? []).filter((userId) => `${nameOf(userId)} ${userId}`.toLowerCase().includes(memberNeedle)));
  const memberAllowed = (userId: string) => editable && level <= own && (userId === me || userLevel(userId) < own);
  const pickNeedle = $derived(pickQuery.trim().toLowerCase());
  const candidates = $derived(joined.filter((userId) => userLevel(userId) !== level && userLevel(userId) < own && `${nameOf(userId)} ${userId}`.toLowerCase().includes(pickNeedle)));

  const canon = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(canon).join(",")}]`
      : value && typeof value === "object"
        ? `{${Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canon((value as Record<string, unknown>)[key])}`).join(",")}}`
        : JSON.stringify(value);
  const snapshotMeta = (list: RoleMeta[]) => canon([...list].sort((a, b) => b.level - a.level));
  let savedPower = $state<string | null>(null);
  let savedMeta = $state<string | null>(null);
  $effect(() => void (canon(original), (savedPower = null)));
  $effect(() => void (snapshotMeta(originalMeta), (savedMeta = null)));
  const powerChanged = $derived(canon($state.snapshot(draft)) !== (savedPower ?? canon(original)));
  const metaChanged = $derived(snapshotMeta($state.snapshot(meta) as RoleMeta[]) !== (savedMeta ?? snapshotMeta(originalMeta)));
  let bar: HTMLDivElement | undefined = $state();
  const nudge = () => bar && (bar.classList.remove("nudged"), void bar.offsetWidth, bar.classList.add("nudged"));
  const changed = $derived(powerChanged || metaChanged);
  const ownNext = $derived(draft.users?.[me] ?? base);

  const open = (next: Selection, nextTab: Tab = "display") => ((selected = next), (tab = nextTab), (editing = true), (levelError = false), (memberQuery = ""), (permQuery = ""));
  const back = () => (editing = false);

  const metaFor = (value: number) => meta.find((entry) => entry.level === value);
  const setMeta = (value: number, patch: Partial<RoleMeta>) =>
    (meta = [...meta.filter((entry) => entry.level !== value), { name: roleName(value), ...metaFor(value), ...patch, level: value }]);

  const setUser = (userId: string, value: number) => (draft.users = { ...draft.users, [userId]: value });
  const resetUser = (userId: string) => (draft.users = Object.fromEntries(Object.entries(draft.users ?? {}).filter(([id]) => id !== userId)));

  const create = () => {
    const value = free ?? base + 1;
    setMeta(value, { name: text("new_role"), color: PALETTE[roles.length % PALETTE.length] });
    open(value, "display");
  };

  const remove = (target: Role) => {
    draft.users = Object.fromEntries(Object.entries(draft.users ?? {}).filter(([, value]) => value !== target.level));
    meta = meta.filter((entry) => entry.level !== target.level);
    editing = editing && selected !== target.level;
    deleting = null;
  };

  const moveLevel = (from: number, raw: string) => {
    const to = Math.trunc(Number(raw));
    const valid = Number.isFinite(to) && to > base && to < own && !roles.some((entry) => entry.level === to);
    levelError = !valid && to !== from;
    valid &&
      ((draft.users = Object.fromEntries(Object.entries(draft.users ?? {}).map(([id, value]) => [id, value === from ? to : value]))),
      (meta = [...meta.filter((entry) => entry.level !== from), { ...(metaFor(from) ?? { name: roleName(from) }), level: to }]),
      (selected = to));
  };

  const toggle = (permission: Permission, on: boolean) => grant(draft, permission, level, on);
  const clearPermissions = () => PERMISSIONS.filter((permission) => permAllowed(permission) && permOn(permission)).forEach((permission) => grant(draft, permission, level, false));

  const upload = (file: File | undefined) =>
    file &&
    $session &&
    ((uploading = true),
    uploadImage($session, file, file.name)
      .then((url) => setMeta(level, { icon: url }))
      .catch(() => (failed = true))
      .finally(() => ((uploading = false), picker && (picker.value = ""))));

  const addPicked = () => (picked.forEach((userId) => setUser(userId, level)), (picked = []), (picking = false));
  const pick = (userId: string) => (picked = picked.includes(userId) ? picked.filter((id) => id !== userId) : [...picked, userId]);

  const reset = () => ((draft = structuredClone($state.snapshot(original) as PowerLevels)), (meta = structuredClone(originalMeta)), (failed = false), (levelError = false));

  const commit = () => {
    busy = true;
    failed = false;
    Promise.all([
      powerChanged && setPowerLevels($session!, roomId, $state.snapshot(draft) as PowerLevels),
      metaChanged && setRoles($session!, roomId, { roles: [...($state.snapshot(meta) as RoleMeta[])].sort((a, b) => b.level - a.level) }),
    ])
      .then(() => ((savedPower = canon($state.snapshot(draft))), (savedMeta = snapshotMeta($state.snapshot(meta) as RoleMeta[])), (busy = false), (demoting = false), toastKey("power_saved", { icon: "check", tone: "success" })))
      .catch(() => ((busy = false), (demoting = false), (failed = true)));
  };

  const save = () => !busy && changed && $session && (ownNext < own ? (demoting = true) : commit());
  const close = () => !busy && (changed ? nudge() : exit.close());

  const openMore = (event: MouseEvent, items: MenuItem[]) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openEntityMenu(items, rect.left, rect.bottom + 4);
  };

  const roleItems = (target: Role): MenuItem[] => [
    { id: "edit", label: text("edit_role"), icon: MENU_ICONS.edit, run: () => open(target.level, "display") },
    { id: "permissions", label: text("tabs", "permissions"), icon: MENU_ICONS.settings, run: () => open(target.level, "permissions") },
    { id: "members", label: text("tabs", "members"), icon: MENU_ICONS.profile, run: () => open(target.level, "members") },
    { id: "copy-name", label: text("copy_name"), icon: MENU_ICONS.copy, separated: true, run: () => copied(target.name) },
    { id: "copy-level", label: text("copy_level"), icon: MENU_ICONS.copy, run: () => copied(String(target.level)) },
    { id: "delete", label: text("delete_role"), icon: MENU_ICONS.delete, danger: true, separated: true, disabled: !(editable && metaEditable && target.level < own), run: () => (deleting = target) },
  ];
  const everyoneItems = (): MenuItem[] => [
    { id: "everyone", label: text("tabs", "permissions"), icon: MENU_ICONS.settings, run: () => open("everyone", "permissions") },
    { id: "copy-level", label: text("copy_level"), icon: MENU_ICONS.copy, run: () => copied(String(base)) },
  ];
  const createItems = (): MenuItem[] => [{ id: "create", label: text("create"), icon: MENU_ICONS.add, disabled: !canCreate, run: create }];
  const memberItems = (userId: string): MenuItem[] => [
    { id: "remove", label: text("remove_member"), icon: MENU_ICONS.close, danger: true, disabled: !memberAllowed(userId), run: () => resetUser(userId) },
    { id: "copy-user", label: text("copy_user"), icon: MENU_ICONS.copy, separated: true, run: () => copied(userId) },
  ];
  const permItems = (permission: Permission): MenuItem[] => [
    { id: "toggle", label: text("perm", permission.key, "label"), icon: MENU_ICONS.settings, selected: permOn(permission), disabled: !permAllowed(permission), run: () => toggle(permission, !permOn(permission)) },
    { id: "copy-level", label: text("copy_level"), icon: MENU_ICONS.copy, separated: true, run: () => copied(String(permission.read(draft))) },
  ];
  const colourItems = (value: string | undefined): MenuItem[] => [
    { id: "use", label: text("colour"), icon: MENU_ICONS.edit, selected: colour === value, disabled: !displayEditable, run: () => setMeta(level, { color: value }) },
    ...(value ? [{ id: "copy", label: text("copy_colour"), icon: MENU_ICONS.copy, run: () => copied(value) }] : []),
  ];
  const tabItems = (id: Tab): MenuItem[] => [{ id, label: text("tabs", id), icon: MENU_ICONS.open, selected: activeTab === id, run: () => (tab = id) }];
  const closeItems = (): MenuItem[] => [{ id: "close", label: text("close"), icon: MENU_ICONS.close, run: close }];
  const backItems = (): MenuItem[] => [{ id: "back", label: text("back"), icon: MENU_ICONS.collapse, run: back }];
  const saveItems = (): MenuItem[] => [
    { id: "save", label: text("save"), icon: MENU_ICONS.save, disabled: busy, run: save },
    { id: "reset", label: text("reset_changes"), icon: MENU_ICONS.retry, disabled: busy, run: reset },
  ];
  const iconItems = (): MenuItem[] => [
    { id: "upload", label: text("icon_upload"), icon: MENU_ICONS.image, disabled: !displayEditable || uploading, run: () => picker?.click() },
    { id: "remove", label: text("icon_remove"), icon: MENU_ICONS.delete, danger: true, disabled: !displayEditable || !role?.icon, run: () => setMeta(level, { icon: undefined }) },
  ];
</script>

{#snippet search(value: string, label: string, set: (next: string) => void)}
  <label class="set-input search">
    <span class="faint row-nw"><Icon name="search" size={16} /></span>
    <input type="search" placeholder={label} aria-label={label} {value} oninput={(event) => set(event.currentTarget.value)} />
  </label>
{/snippet}

{#snippet badge(target: Role | undefined, size: number)}
  <span class="badge" style:--role={target?.color ?? "var(--colours-text-faint)"} style:--size="{size}px">
    {#if target?.icon}
      <Avatar name={target.name} url={target.icon} size="{size}px" radius="50%" />
    {:else}
      <Icon name="shield" size={size} />
    {/if}
  </span>
{/snippet}

<span class="portal-anchor" hidden></span>
<div class="roles-layer set-surface" class:closing={exit.closing} role="presentation" use:portal>
  <button type="button" class="roles-scrim ghost" tabindex="-1" aria-hidden="true" onclick={close}></button>
  <div class="roles-card col" role="dialog" aria-modal="true" aria-label={text("title")} tabindex="-1" inert={exit.closing} onanimationend={exit.onanimationend} onkeydown={(event) => event.key === "Escape" && close()}>
    <header class="head row-nw align-centre gap-sm">
      <h2 class="head-title flex-max truncate">{text("title")}<span class="faint"> · <EmojiText text={room?.name ?? ""} /></span></h2>
      <button type="button" class="round ghost press" aria-label={text("close")} onclick={close} use:menu={closeItems}><Icon name="close" /></button>
    </header>

    <div class="pages" class:editing>
      <section class="page list-page col" inert={editing} aria-hidden={editing}>
        <div class="list-body col">
          <p class="set-hint">{text("intro")}</p>
          <div class="reveal" class:open={!editable}>
            <p class="clip set-hint warn">{text("read_only")}</p>
          </div>

          <button type="button" class="everyone-card set-panel row-nw align-centre gap-md ghost press" onclick={() => open("everyone", "permissions")} use:menu={everyoneItems}>
            <span class="set-tile"><Icon name="members" size={20} /></span>
            <span class="col flex-max min-0">
              <span class="set-title">{text("everyone")}</span>
              <span class="sm faint truncate">{text("everyone_hint")}</span>
            </span>
            <span class="faint row-nw"><Icon name="next" size={20} /></span>
          </button>

          <div class="reveal" class:open={roles.length > 0}>
            <div class="clip">
              <div class="toolbar row-nw align-centre gap-sm">
                {@render search(query, text("search_roles"), (next) => (query = next))}
                <button type="button" class="set-button primary press" disabled={!canCreate} onclick={create} use:menu={createItems}>{text("create")}</button>
              </div>
            </div>
          </div>

          <div class="reveal" class:open={roles.length > 0}>
            <div class="clip">
              <div class="table col">
                <div class="table-head row-nw align-centre">
                  <span class="set-label flex-max">{fill("col_roles", { count: roles.length })}</span>
                  <span class="set-label count-col">{text("col_members")}</span>
                  <span class="actions-col"></span>
                </div>
                {#each shownRoles as entry (entry.level)}
                  <div class="row-wrap" transition:grow>
                    <div class="clip">
                      <div
                        class="role-row row-nw align-centre"
                        role="button"
                        tabindex="0"
                        onclick={() => open(entry.level, "display")}
                        onkeydown={(event) => event.key === "Enter" && open(entry.level, "display")}
                        use:menu={() => roleItems(entry)}
                      >
                        <span class="row-nw align-centre gap-sm flex-max min-0">
                          {@render badge(entry, 20)}
                          <span class="md truncate role-name" style:color={entry.color}>{entry.name}</span>
                        </span>
                        <span class="count-col row-nw align-centre gap-xs sm muted"><Icon name="members" size={16} />{entry.members.length}</span>
                        <span class="actions-col row-nw gap-xs">
                          <button type="button" class="round ghost press" aria-label={text("edit_role")} onclick={(event) => (event.stopPropagation(), open(entry.level, "display"))} use:menu={() => roleItems(entry)}><Icon name="edit" size={16} /></button>
                          <button type="button" class="round ghost press" aria-label={text("more")} aria-haspopup="menu" onclick={(event) => (event.stopPropagation(), openMore(event, roleItems(entry)))} use:menu={() => roleItems(entry)}><Icon name="more" size={18} /></button>
                        </span>
                      </div>
                    </div>
                  </div>
                {/each}
                <div class="reveal" class:open={!shownRoles.length}>
                  <p class="clip set-hint none">{text("no_match")}</p>
                </div>
              </div>
            </div>
          </div>

          <div class="reveal" class:open={!roles.length}>
            <div class="clip">
              <div class="empty col align-centre gap-md">
                <span class="empty-art"><Icon name="shield" size={40} /></span>
                <h3 class="set-heading">{text("empty_title")}</h3>
                <p class="set-hint">{text("empty_body")}</p>
                <button type="button" class="set-button primary press" disabled={!canCreate} onclick={create} use:menu={createItems}>{text("create")}</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="page edit-page row-nw" inert={!editing} aria-hidden={!editing}>
        <aside class="side col">
          <div class="side-head row-nw align-centre gap-xs">
            <button type="button" class="back ghost press row-nw align-centre gap-xs flex-max" onclick={back} use:menu={backItems}><Icon name="back" size={18} />{text("back")}</button>
            <button type="button" class="round ghost press" aria-label={text("create")} disabled={!canCreate} onclick={create} use:menu={createItems}><Icon name="add" size={18} /></button>
          </div>
          <div class="side-list col">
            {#each roles as entry (entry.level)}
              <div class="row-wrap" transition:grow>
                <div class="clip">
                  <button type="button" class="side-item ghost press row-nw align-centre gap-sm" aria-current={selected === entry.level ? "page" : undefined} onclick={() => open(entry.level, activeTab === "permissions" ? "permissions" : tab)} use:menu={() => roleItems(entry)}>
                    <span class="dot" style:background-color={entry.color ?? "var(--colours-text-faint)"}></span>
                    <span class="sm truncate flex-max">{entry.name}</span>
                  </button>
                </div>
              </div>
            {/each}
            <button type="button" class="side-item ghost press row-nw align-centre gap-sm" aria-current={everyone ? "page" : undefined} onclick={() => open("everyone", "permissions")} use:menu={everyoneItems}>
              <span class="dot"></span>
              <span class="sm truncate flex-max">{text("everyone_role")}</span>
            </button>
          </div>
        </aside>

        <main class="editor col flex-max min-0">
          <div class="editor-head col">
            <div class="row-nw align-centre gap-sm">
              <button type="button" class="round ghost press mobile-back" aria-label={text("back")} onclick={back} use:menu={backItems}><Icon name="back" size={20} /></button>
              <h3 class="set-title truncate flex-max">{fill("edit_title", { name: everyone ? text("everyone_role") : (role?.name ?? "") })}</h3>
              <button type="button" class="round ghost press" class:hidden={everyone} aria-label={text("more")} aria-haspopup="menu" disabled={everyone || !role} onclick={(event) => role && openMore(event, roleItems(role))} use:menu={() => (role ? roleItems(role) : [])}><Icon name="more" size={18} /></button>
            </div>
            <div class="tabs" role="tablist" style:--count={tabs.length} style:--index={tabs.indexOf(activeTab)}>
              {#each tabs as id (id)}
                <button type="button" role="tab" class="tab ghost press sm" aria-selected={activeTab === id} onclick={() => (tab = id)} use:menu={() => tabItems(id)}>
                  {id === "members" ? text("tabs", "members_count").replace("{count}", String(role?.members.length ?? 0)) : text("tabs", id)}
                </button>
              {/each}
              <span class="tab-mark" aria-hidden="true"></span>
            </div>
          </div>

          <div class="editor-body col">
            <div class="reveal" class:open={activeTab === "display"} inert={activeTab !== "display"}>
              <div class="clip">
                <div class="panel col">
                  <label class="field col">
                    <span class="set-label">{text("name")}</span>
                    <span class="set-input">
                      <input type="text" maxlength="64" value={role?.name ?? ""} disabled={!displayEditable} oninput={(event) => setMeta(level, { name: event.currentTarget.value })} />
                    </span>
                  </label>

                  <label class="field col">
                    <span class="set-label">{text("level")}</span>
                    <span class="set-input">
                      <input type="number" step="1" min={base + 1} max={own - 1} value={level} disabled={!(roleEditable && metaEditable)} onchange={(event) => moveLevel(level, event.currentTarget.value)} />
                    </span>
                    <span class="sm faint">{fill("level_hint", { min: base + 1, max: own - 1 })}</span>
                    <span class="reveal" class:open={levelError}><span class="clip sm error" role="alert">{text("level_taken")}</span></span>
                  </label>

                  <div class="field col">
                    <span class="set-label">{text("colour")}</span>
                    <span class="sm faint">{text("colour_hint")}</span>
                    <div class="colours row-nw gap-md">
                      <button type="button" class="big-swatch ghost press" class:on={!colour} aria-label={text("colour_default")} disabled={!displayEditable} onclick={() => setMeta(level, { color: undefined })} use:menu={() => colourItems(undefined)}>
                        <span class="check"><Icon name="check" size={20} /></span>
                      </button>
                      <button type="button" class="big-swatch custom ghost press" class:on={!!colour && !PALETTE.includes(colour)} style:background-color={colour && !PALETTE.includes(colour) ? colour : undefined} aria-label={text("colour_custom")} aria-expanded={!!colourAnchor} disabled={!displayEditable} use:menu={() => colourItems(colour)} onclick={(event) => (colourAnchor = colourAnchor ? null : event.currentTarget)}>
                        <span class="check"><Icon name="check" size={20} /></span>
                        <span class="pen"><Icon name="appearance" size={14} /></span>
                      </button>
                      {#if colourAnchor}
                        <ColourPopover anchor={colourAnchor} value={colour ?? "#99aab5"} onchange={(value) => setMeta(level, { color: value })} onclose={() => (colourAnchor = null)} />
                      {/if}
                      <div class="palette">
                        {#each PALETTE as swatch (swatch)}
                          <button type="button" class="swatch ghost press" class:on={colour === swatch} style:background-color={swatch} aria-label={swatch} disabled={!displayEditable} onclick={() => setMeta(level, { color: swatch })} use:menu={() => colourItems(swatch)}>
                            <span class="check"><Icon name="check" size={14} /></span>
                          </button>
                        {/each}
                      </div>
                    </div>
                  </div>

                  <div class="field col">
                    <span class="set-label">{text("icon")}</span>
                    <span class="sm faint">{text("icon_hint")}</span>
                    <div class="row-nw align-centre gap-md">
                      <span class="set-tile icon-tile" use:menu={iconItems}>{@render badge(role, 24)}</span>
                      <button type="button" class="set-button press" disabled={!displayEditable || uploading} onclick={() => picker?.click()} use:menu={iconItems}>{text(uploading ? "icon_uploading" : "icon_upload")}</button>
                      <button type="button" class="set-button outline-danger press fade" class:gone={!role?.icon} disabled={!displayEditable || !role?.icon} onclick={() => setMeta(level, { icon: undefined })} use:menu={iconItems}>{text("icon_remove")}</button>
                      <input class="file" type="file" accept="image/*" bind:this={picker} onchange={(event) => upload(event.currentTarget.files?.[0])} />
                    </div>
                  </div>

                  <div class="field col">
                    <span class="set-label">{text("preview_label")}</span>
                    <div class="preview set-panel row-nw gap-md">
                      <Avatar name={nameOf(me)} url={avatarOf(me)} size="40px" radius="50%" />
                      <span class="col min-0">
                        <span class="row-nw align-centre gap-xs">
                          <span class="md bold truncate preview-name" style:color={colour}><EmojiText text={nameOf(me)} /></span>
                          {#if role?.icon}{@render badge(role, 16)}{/if}
                        </span>
                        <span class="md">{text("preview_text")}</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="reveal" class:open={activeTab === "permissions"} inert={activeTab !== "permissions"}>
              <div class="clip">
                <div class="panel col">
                  <div class="row-nw align-centre gap-sm">
                    {@render search(permQuery, text("search_permissions"), (next) => (permQuery = next))}
                    <button type="button" class="set-button press" disabled={!roleEditable} onclick={clearPermissions} use:menu={() => [{ id: "clear", label: text("clear_permissions"), icon: MENU_ICONS.retry, disabled: !roleEditable, run: clearPermissions }]}>{text("clear_permissions")}</button>
                  </div>
                  {#each permGroups as { group, items } (group)}
                    <div class="reveal" class:open={items.length > 0}>
                      <div class="clip">
                        <div class="perm-group col">
                          <span class="set-label">{text("groups", group)}</span>
                          {#each items as permission (permission.key)}
                            <div class="row-wrap" transition:grow>
                              <div class="clip">
                                <div class="perm row-nw align-centre gap-lg" use:menu={() => permItems(permission)}>
                                  <span class="col flex-max min-0">
                                    <span class="md perm-label">{text("perm", permission.key, "label")}</span>
                                    <span class="sm faint">{text("perm", permission.key, "hint")}</span>
                                  </span>
                                  <Toggle checked={permOn(permission)} label={text("perm", permission.key, "label")} disabled={!permAllowed(permission)} onchange={(on) => toggle(permission, on)} />
                                </div>
                              </div>
                            </div>
                          {/each}
                        </div>
                      </div>
                    </div>
                  {/each}
                  <div class="reveal" class:open={permGroups.every((entry) => !entry.items.length)}>
                    <p class="clip set-hint">{text("no_permissions")}</p>
                  </div>
                </div>
              </div>
            </div>

            <div class="reveal" class:open={activeTab === "members"} inert={activeTab !== "members"}>
              <div class="clip">
                <div class="panel col">
                  <div class="row-nw align-centre gap-sm">
                    {@render search(memberQuery, text("search_members"), (next) => (memberQuery = next))}
                    <button type="button" class="set-button primary press" disabled={!roleEditable} onclick={() => ((picked = []), (pickQuery = ""), (picking = true))} use:menu={() => [{ id: "add", label: text("add_members"), icon: MENU_ICONS.add, disabled: !roleEditable, run: () => (picking = true) }]}>{text("add_members")}</button>
                  </div>
                  <div class="col">
                    {#each roleMembers as userId (userId)}
                      <div class="row-wrap" transition:grow>
                        <div class="clip">
                          <div class="member row-nw align-centre gap-sm" use:menu={() => memberItems(userId)}>
                            <Avatar name={nameOf(userId)} url={avatarOf(userId)} size="32px" radius="50%" />
                            <span class="col min-0 flex-max">
                              <span class="sm bold truncate"><EmojiText text={nameOf(userId)} /></span>
                              <span class="xs faint truncate">{userId}</span>
                            </span>
                            <button type="button" class="round ghost press" aria-label={text("remove_member")} disabled={!memberAllowed(userId)} onclick={() => resetUser(userId)} use:menu={() => memberItems(userId)}><Icon name="close" size={16} /></button>
                          </div>
                        </div>
                      </div>
                    {/each}
                    <div class="reveal" class:open={!roleMembers.length}>
                      <p class="clip set-hint none">{text(role?.members.length ? "no_member_match" : "no_role_members")}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </section>
    </div>

    <div class="savebar row-nw align-centre gap-sm" class:open={changed || busy} inert={!(changed || busy)} bind:this={bar} role="status" use:menu={saveItems} onanimationend={(event) => event.animationName.includes("flash") && bar?.classList.remove("nudged")}>
      <span class="unsaved-text truncate">{text(failed ? "failed" : "unsaved")}</span>
      <button type="button" class="unsaved-reset ghost press" disabled={busy} onclick={reset}>{text("reset_changes")}</button>
      <button type="button" class="unsaved-save ghost press" disabled={busy || !(editable || metaEditable)} onclick={save}>{text(busy ? "saving" : "save")}</button>
    </div>
  </div>
</div>
<span class="portal-anchor" hidden></span>

{#if picking}
  <ConfirmDialog title={fill("add_title", { name: role?.name ?? "" })} cancelLabel={text("cancel")} tone="primary" onclose={() => (picking = false)}>
    <div class="picker set-surface col gap-sm">
      {@render search(pickQuery, text("search_members"), (next) => (pickQuery = next))}
      <div class="pick-list col">
        {#each candidates as userId (userId)}
          <button type="button" class="pick-row ghost press row-nw align-centre gap-sm" aria-pressed={picked.includes(userId)} onclick={() => pick(userId)} use:menu={() => [{ id: "pick", label: nameOf(userId), icon: MENU_ICONS.add, selected: picked.includes(userId), run: () => pick(userId) }, { id: "copy", label: text("copy_user"), icon: MENU_ICONS.copy, run: () => copied(userId) }]}>
            <Avatar name={nameOf(userId)} url={avatarOf(userId)} size="28px" radius="50%" />
            <span class="col min-0 flex-max">
              <span class="sm bold truncate"><EmojiText text={nameOf(userId)} /></span>
              <span class="xs faint truncate">{userId}</span>
            </span>
            <span class="tick"><Icon name="check" size={14} /></span>
          </button>
        {:else}
          <p class="set-hint">{text("no_candidates")}</p>
        {/each}
      </div>
    </div>
    {#snippet actions()}
      <button type="button" class="dialog-button ghost press sm bold primary" disabled={!picked.length} onclick={addPicked}>{text("add")}</button>
    {/snippet}
  </ConfirmDialog>
{/if}

{#if deleting}
  <ConfirmDialog title={fill("delete_title", { name: deleting.name })} body={text("delete_body")} cancelLabel={text("cancel")} confirmLabel={text("delete_confirm")} onconfirm={() => deleting && remove(deleting)} onclose={() => (deleting = null)} />
{/if}


{#if demoting}
  <ConfirmDialog title={text("demote_title")} body={text("demote_body")} cancelLabel={text("cancel")} confirmLabel={text("demote_confirm")} {busy} onconfirm={commit} onclose={() => (demoting = false)} />
{/if}

<style>
  .roles-layer {
    position: fixed;
    inset: 0;
    z-index: var(--azure-z-overlay);
    display: grid;
    place-items: center;
    interpolate-size: allow-keywords;
  }

  .roles-layer :global(:is(input, button, label, [role="button"]):is(:focus, :focus-visible)) {
    outline: none;
  }

  .roles-scrim {
    position: absolute;
    inset: 0;
    cursor: default;
    background-color: var(--colours-scrim);
    backdrop-filter: blur(6px);
    animation: roles-fade var(--azure-duration-slow) var(--sheet);
  }

  .roles-card {
    position: relative;
    width: min(1100px, calc(100vw - 72px));
    height: min(820px, calc(100dvh - 28px));
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid var(--line);
    background-color: var(--card);
    box-shadow: 0 24px 64px -16px black;
    outline: none;
    animation: roles-pop var(--azure-duration-slow) var(--sheet);
  }

  .closing .roles-scrim {
    animation: exit-fade var(--azure-duration-md) var(--sheet) forwards;
  }

  .closing .roles-card {
    animation: roles-out var(--azure-duration-md) var(--sheet) forwards;
  }

  .head {
    flex: none;
    min-height: 52px;
    padding: 0 12px 0 20px;
    border-bottom: 1px solid var(--line);
  }

  .head-title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 500;
    color: var(--colours-text-strong);
  }

  .round {
    width: 32px;
    height: 32px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--colours-text-faint);
    transition:
      opacity 320ms var(--sheet),
      background-color 200ms var(--sheet),
      color 200ms var(--sheet);
  }

  .round:hover:not(:disabled) {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .round:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .round.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .pages {
    position: relative;
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 100% 100%;
    overflow: hidden;
  }

  .page {
    grid-row: 1;
    min-height: 0;
    transition:
      transform 520ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity 520ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .list-page {
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .edit-page {
    transform: translateX(8%);
    opacity: 0;
  }

  .editing .list-page {
    transform: translateX(-100%) scale(0.98);
    opacity: 0;
  }

  .editing .edit-page {
    transform: translateX(-100%);
    opacity: 1;
  }

  .list-body {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    gap: 20px;
    padding: 32px 24px 112px;
  }

  .warn {
    color: var(--colours-text);
  }

  .everyone-card {
    width: 100%;
    text-align: left;
    transition: background-color 200ms var(--sheet);
  }

  .everyone-card:hover {
    background-color: var(--fill);
  }

  .toolbar .search {
    flex: 1;
  }

  .search {
    flex: 1;
    min-width: 0;
  }

  .search input {
    font-size: max(16px, var(--text-sm));
  }

  .table-head {
    padding: 0 8px 8px;
    border-bottom: 1px solid var(--line);
  }

  .count-col {
    width: 96px;
    flex: none;
  }

  .actions-col {
    width: 72px;
    flex: none;
    justify-content: flex-end;
  }

  .row-wrap {
    display: grid;
    grid-template-rows: 1fr;
  }

  .role-row {
    min-height: 56px;
    padding: 0 8px;
    border-radius: 8px;
    border-bottom: 1px solid var(--line);
    cursor: pointer;
    transition: background-color 200ms var(--sheet);
  }

  .role-row:hover {
    background-color: var(--colours-surface-hover);
  }

  .role-name {
    font-weight: 500;
    color: var(--colours-text-strong);
    transition: color 320ms var(--sheet);
  }

  .badge {
    width: var(--size);
    height: var(--size);
    flex: none;
    display: grid;
    place-items: center;
    color: var(--role);
    transition: color 320ms var(--sheet);
  }

  .none {
    padding: 16px 8px;
  }

  .empty {
    padding: 48px 24px;
    text-align: center;
  }

  .empty-art {
    width: 88px;
    height: 88px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    color: var(--colours-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 14%, transparent);
  }

  .side {
    width: 232px;
    flex: none;
    min-height: 0;
    padding: 16px 12px;
    gap: 8px;
    border-right: 1px solid var(--line);
    overflow-y: auto;
    scrollbar-width: none;
  }

  .back {
    min-height: 32px;
    padding: 0 8px;
    border-radius: 8px;
    font-weight: 500;
    color: var(--colours-text-muted);
    transition:
      color 200ms var(--sheet),
      background-color 200ms var(--sheet);
  }

  .back:hover {
    color: var(--colours-text-strong);
    background-color: var(--colours-surface-hover);
  }

  .side-item {
    width: 100%;
    min-height: 36px;
    padding: 0 10px;
    border-radius: 8px;
    text-align: left;
    color: var(--colours-text-muted);
    transition:
      color 200ms var(--sheet),
      background-color 320ms var(--sheet);
  }

  .side-item:hover {
    color: var(--colours-text);
    background-color: var(--colours-surface-hover);
  }

  .side-item[aria-current="page"] {
    color: var(--colours-text-strong);
    background-color: color-mix(in oklab, white 13%, var(--card));
  }

  .dot {
    width: 12px;
    height: 12px;
    flex: none;
    border-radius: 50%;
    background-color: var(--colours-text-faint);
    transition: background-color 320ms var(--sheet);
  }

  .editor {
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
  }

  .editor-head {
    position: sticky;
    top: 0;
    z-index: 2;
    gap: 12px;
    padding: 20px 24px 0;
    background-color: var(--card);
  }

  .mobile-back {
    display: none;
  }

  .tabs {
    position: relative;
    display: grid;
    grid-template-columns: repeat(var(--count), minmax(0, 1fr));
    max-width: calc(var(--count) * 200px);
    border-bottom: 1px solid var(--line);
  }

  .tab {
    min-height: 40px;
    padding: 0;
    white-space: nowrap;
    font-weight: 500;
    color: var(--colours-text-muted);
    transition: color 320ms var(--sheet);
  }

  .tab:hover,
  .tab[aria-selected="true"] {
    color: var(--colours-text-strong);
  }

  .tab-mark {
    position: absolute;
    left: 0;
    bottom: -1px;
    width: calc(100% / var(--count));
    height: 2px;
    transform: translateX(calc(var(--index) * 100%));
    border-radius: 2px;
    background-color: var(--colours-accent);
    pointer-events: none;
    transition:
      transform 420ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .editor-body {
    padding: 0 24px 112px;
  }

  .panel {
    gap: 28px;
    padding-top: 24px;
  }

  .field {
    gap: 8px;
  }

  .field input:disabled {
    opacity: 0.6;
  }

  .error {
    color: var(--colours-danger);
  }

  .colours {
    flex-wrap: wrap;
    align-items: flex-start;
  }

  .big-swatch {
    position: relative;
    width: 64px;
    height: 52px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 8px;
    border: 1px solid var(--line);
    color: white;
    background-color: var(--fill);
    cursor: pointer;
    transition: background-color 320ms var(--sheet);
  }

  .big-swatch:first-child {
    background-color: #99aab5;
  }

  .pen {
    position: absolute;
    top: 4px;
    right: 4px;
    display: grid;
    color: white;
    pointer-events: none;
  }

  .palette {
    display: grid;
    grid-template-columns: repeat(10, 22px);
    gap: 8px;
  }

  .swatch {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border-radius: 4px;
    color: white;
    transition: transform 320ms var(--sheet);
  }

  .swatch:hover:not(:disabled) {
    transform: scale(1.12);
  }

  .swatch:disabled,
  .big-swatch:disabled {
    cursor: default;
  }

  .check {
    display: grid;
    pointer-events: none;
    opacity: 0;
    transform: scale(0.6);
    transition:
      opacity 320ms var(--sheet),
      transform 320ms var(--sheet);
  }

  .on .check {
    opacity: 1;
    transform: scale(1);
  }

  .icon-tile {
    width: 52px;
    height: 52px;
  }

  .file {
    display: none;
  }

  .fade {
    transition: opacity 320ms var(--sheet);
  }

  .fade.gone {
    opacity: 0;
    pointer-events: none;
  }

  .preview {
    align-items: flex-start;
  }

  .preview-name {
    color: var(--colours-text-strong);
    transition: color 320ms var(--sheet);
  }

  .perm-group {
    gap: 4px;
  }

  .perm {
    min-height: 64px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line);
  }

  .perm-label {
    font-weight: 500;
    color: var(--colours-text-strong);
  }

  .member {
    min-height: 52px;
    padding: 4px 8px;
    border-radius: 8px;
    transition: background-color 200ms var(--sheet);
  }

  .member:hover {
    background-color: var(--colours-surface-hover);
  }

  .reveal {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition:
      grid-template-rows 420ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity 420ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .reveal.open {
    grid-template-rows: 1fr;
    opacity: 1;
  }

  .clip {
    min-height: 0;
    margin: 0;
    overflow: hidden;
  }

  .savebar {
    position: absolute;
    left: 50%;
    bottom: 20px;
    max-width: calc(100% - 32px);
    padding: 6px 6px 6px 16px;
    border-radius: var(--azure-radius-pill);
    background-color: var(--colours-foreground);
    border: 1px solid var(--colours-outline-hairline);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.35);
    color: var(--colours-text);
    font-size: var(--text-sm);
    font-weight: 500;
    white-space: nowrap;
    opacity: 0;
    translate: -50% 24px;
    scale: 0.92;
    transition:
      translate 460ms cubic-bezier(0.32, 0.72, 0, 1),
      scale 460ms cubic-bezier(0.32, 0.72, 0, 1),
      opacity 460ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .savebar.open {
    opacity: 1;
    translate: -50% 0;
    scale: 1;
  }

  .unsaved-reset,
  .unsaved-save {
    flex: none;
    min-height: 30px;
    border-color: transparent;
    font-size: var(--text-sm);
  }

  .unsaved-reset {
    margin: 0 10px 0 20px;
    color: var(--colours-text-muted);
  }

  .unsaved-reset:hover:not(:disabled) {
    color: var(--colours-text-strong);
    text-decoration: underline;
  }

  .unsaved-save {
    padding: 0 16px;
    border-radius: var(--azure-radius-pill);
    font-weight: 600;
    color: var(--colours-on-accent);
    background-color: color-mix(in oklab, var(--colours-accent) 78%, var(--colours-surface-raised));
    transition: background-color 240ms cubic-bezier(0.32, 0.72, 0, 1);
  }

  .unsaved-save:hover:not(:disabled) {
    background-color: var(--colours-accent);
  }

  .savebar button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .savebar:global(.nudged) {
    animation:
      unsaved-shake 500ms linear,
      unsaved-flash 600ms var(--azure-ease-out);
  }

  .savebar:global(.nudged) .unsaved-text {
    animation: unsaved-bold 600ms var(--azure-ease-out);
  }

  .savebar:global(.nudged) .unsaved-reset {
    animation: unsaved-reset-flash 600ms var(--azure-ease-out);
  }

  .savebar:global(.nudged) .unsaved-save {
    animation: unsaved-save-flash 600ms var(--azure-ease-out);
  }

  @keyframes unsaved-bold {
    0%,
    35% {
      font-weight: 700;
    }
  }

  @keyframes unsaved-reset-flash {
    0%,
    35% {
      color: white;
    }
  }

  @keyframes unsaved-save-flash {
    0%,
    35% {
      color: var(--colours-danger);
      background-color: white;
    }
  }

  @keyframes unsaved-shake {
    10% {
      transform: translateX(-10px) scale(1.03);
    }
    22% {
      transform: translateX(9px) scale(1.02);
    }
    34% {
      transform: translateX(-7px) scale(1.01);
    }
    46% {
      transform: translateX(6px);
    }
    58% {
      transform: translateX(-4px);
    }
    70% {
      transform: translateX(3px);
    }
    84% {
      transform: translateX(-1px);
    }
  }

  @keyframes unsaved-flash {
    0%,
    35% {
      background-color: color-mix(in oklab, var(--colours-danger) 85%, var(--colours-surface-raised));
      border-color: var(--colours-danger);
      color: white;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .savebar:global(.nudged) {
      animation: unsaved-flash 600ms var(--azure-ease-out);
    }
  }

  :global(:root[data-motion="reduce"]) .savebar:global(.nudged) {
    animation: unsaved-flash 600ms var(--azure-ease-out);
  }

  .dialog-link {
    min-height: 36px;
    padding: 0 12px;
    border-radius: 8px;
    color: var(--colours-text);
  }

  .dialog-link:hover:not(:disabled) {
    text-decoration: underline;
  }

  .picker {
    min-width: 0;
  }

  .pick-list {
    max-height: 50vh;
    overflow-y: auto;
  }

  .pick-row {
    min-height: 44px;
    padding: 4px 8px;
    border-radius: 8px;
    text-align: left;
    transition: background-color 200ms var(--sheet);
  }

  .pick-row:hover,
  .pick-row[aria-pressed="true"] {
    background-color: var(--colours-surface-hover);
  }

  .tick {
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    border: 1px solid var(--line);
    color: transparent;
    transition:
      background-color 320ms var(--sheet),
      color 320ms var(--sheet);
  }

  [aria-pressed="true"] .tick {
    color: var(--colours-on-accent);
    background-color: var(--colours-accent);
  }

  @keyframes roles-fade {
    from {
      opacity: 0;
    }
  }

  @keyframes roles-pop {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
  }

  @keyframes roles-out {
    to {
      opacity: 0;
      transform: scale(0.97);
    }
  }

  @media (max-width: 767px) {
    .roles-card {
      width: 100%;
      height: 100dvh;
      border: 0;
      border-radius: 0;
      box-shadow: none;
    }

    .head {
      padding-top: env(safe-area-inset-top);
      min-height: calc(52px + env(safe-area-inset-top));
    }

    .round {
      width: var(--azure-touch);
      height: var(--azure-touch);
    }

    .side {
      display: none;
    }

    .mobile-back {
      display: grid;
    }

    .list-body,
    .editor-head,
    .editor-body {
      padding-left: 16px;
      padding-right: 16px;
    }

    .count-col {
      width: 56px;
    }

    .actions-col {
      width: auto;
    }

    .actions-col .round:first-child {
      display: none;
    }

    .palette {
      grid-template-columns: repeat(10, minmax(0, 1fr));
      width: 100%;
    }

    .swatch {
      width: 100%;
      height: auto;
      aspect-ratio: 1;
    }

    .savebar {
      bottom: calc(12px + env(safe-area-inset-bottom));
    }
  }
</style>
